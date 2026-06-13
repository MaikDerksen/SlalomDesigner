import express, { type Router } from "express";
import type pg from "pg";
import { pool, tx } from "./db";
import { HttpError, requireAdmin } from "./auth";

/** Obergrenzen gegen Speicher-/DB-Erschöpfung (DoS). */
const LIMITS = { maps: 200, tracks: 500, obstacles: 400, pylons: 64, points: 4000, zones: 50 };
function cap<T>(arr: T[] | undefined, max: number): T[] {
  return Array.isArray(arr) ? arr.slice(0, max) : [];
}

/** Geteilte Datentypen mit dem Frontend (Form der JSON-Payloads). */
interface PylonDto {
  x: number;
  y: number;
  lying?: boolean;
  angle?: number;
}
interface ObstacleDto {
  templateId: string;
  name: string;
  x: number;
  y: number;
  rotation: number;
  pylons: PylonDto[];
}
interface MapPayload {
  name: string;
  width: number;
  height: number;
  boundary?: { x: number; y: number }[];
  blocked?: { x: number; y: number }[][];
  image?: { data: string; pxWidth: number; pxHeight: number };
  calibration?: { a: { x: number; y: number }; b: { x: number; y: number }; refLen: number };
}

/* ---------- Lese-Helfer ---------- */

async function readMapDetail(db: pg.PoolClient | pg.Pool, mapId: string, clubId: string) {
  const m = await db.query(
    `SELECT id, name, width_m::float8 AS width, height_m::float8 AS height,
            cal_ax::float8, cal_ay::float8, cal_bx::float8, cal_by::float8, cal_ref_len_m::float8,
            extract(epoch FROM created_at) * 1000 AS created_at
     FROM maps WHERE id = $1 AND club_id = $2`,
    [mapId, clubId],
  );
  if (!m.rowCount) throw new HttpError(404, "Map nicht gefunden");
  const row = m.rows[0];

  const boundary = (
    await db.query(
      "SELECT x_m::float8 AS x, y_m::float8 AS y FROM map_boundary_points WHERE map_id = $1 ORDER BY point_index",
      [mapId],
    )
  ).rows;

  const zones = (
    await db.query(
      `SELECT z.id, p.x_m::float8 AS x, p.y_m::float8 AS y
       FROM map_blocked_zones z
       JOIN map_blocked_zone_points p ON p.zone_id = z.id
       WHERE z.map_id = $1 ORDER BY z.zone_index, p.point_index`,
      [mapId],
    )
  ).rows;
  const blocked: { x: number; y: number }[][] = [];
  const zoneIdx = new Map<string, number>();
  for (const z of zones) {
    if (!zoneIdx.has(z.id)) {
      zoneIdx.set(z.id, blocked.length);
      blocked.push([]);
    }
    blocked[zoneIdx.get(z.id)!].push({ x: z.x, y: z.y });
  }

  const img = await db.query(
    "SELECT data_url, px_width, px_height FROM map_images WHERE map_id = $1",
    [mapId],
  );

  return {
    id: row.id,
    name: row.name,
    createdAt: Number(row.created_at),
    config: {
      name: row.name,
      width: row.width,
      height: row.height,
      mapId: row.id,
      boundary: boundary.length >= 3 ? boundary : undefined,
      blocked: blocked.length ? blocked : undefined,
    },
    image: img.rowCount
      ? { data: img.rows[0].data_url, pxWidth: img.rows[0].px_width, pxHeight: img.rows[0].px_height }
      : undefined,
    calibration:
      row.cal_ax !== null
        ? { a: { x: row.cal_ax, y: row.cal_ay }, b: { x: row.cal_bx, y: row.cal_by }, refLen: row.cal_ref_len_m }
        : undefined,
  };
}

async function readObstacles(db: pg.PoolClient | pg.Pool, trackId: string): Promise<unknown[]> {
  const obs = (
    await db.query(
      `SELECT id, position_index, template_id, custom_obstacle_id, name,
              x_m::float8 AS x, y_m::float8 AS y, rotation_deg::float8 AS rotation
       FROM track_obstacles WHERE track_id = $1 ORDER BY position_index`,
      [trackId],
    )
  ).rows;
  const pylons = (
    await db.query(
      `SELECT p.obstacle_id, p.x_m::float8 AS x, p.y_m::float8 AS y, p.lying, p.angle_deg::float8 AS angle
       FROM track_obstacle_pylons p
       JOIN track_obstacles o ON o.id = p.obstacle_id
       WHERE o.track_id = $1 ORDER BY p.obstacle_id, p.pylon_index`,
      [trackId],
    )
  ).rows;
  const byObs = new Map<string, PylonDto[]>();
  for (const p of pylons) {
    const arr = byObs.get(p.obstacle_id) ?? [];
    arr.push({ x: p.x, y: p.y, ...(p.lying ? { lying: true, angle: p.angle ?? 0 } : {}) });
    byObs.set(p.obstacle_id, arr);
  }
  return obs.map((o) => ({
    id: o.id,
    templateId: o.template_id ?? o.custom_obstacle_id,
    name: o.name,
    x: o.x,
    y: o.y,
    rotation: o.rotation,
    pylons: byObs.get(o.id) ?? [],
  }));
}

interface RouteDto {
  source: "auto" | "drawn";
  points: { x: number; y: number }[];
}

async function readRoute(db: pg.PoolClient | pg.Pool, trackId: string): Promise<RouteDto | null> {
  const src = await db.query("SELECT route_source FROM tracks WHERE id = $1", [trackId]);
  if (!src.rowCount || !src.rows[0].route_source) return null;
  const pts = await db.query(
    "SELECT x_m::float8 AS x, y_m::float8 AS y FROM track_route_points WHERE track_id = $1 ORDER BY point_index",
    [trackId],
  );
  return { source: src.rows[0].route_source, points: pts.rows };
}

/* ---------- Schreib-Helfer ---------- */

async function writeRoute(c: pg.PoolClient, trackId: string, route: RouteDto | null | undefined) {
  await c.query("DELETE FROM track_route_points WHERE track_id = $1", [trackId]);
  const valid = route && Array.isArray(route.points) && route.points.length > 3;
  await c.query("UPDATE tracks SET route_source = $2 WHERE id = $1", [
    trackId,
    valid ? (route.source === "drawn" ? "drawn" : "auto") : null,
  ]);
  if (!valid) return;
  // Punktmenge begrenzen (Entwürfe werden häufig geschrieben)
  const pts = route.points.slice(0, 4000);
  const values: string[] = [];
  const params: unknown[] = [trackId];
  pts.forEach((p, i) => {
    params.push(i, p.x, p.y);
    const base = 1 + i * 3;
    values.push(`($1, $${base + 1}, $${base + 2}, $${base + 3})`);
  });
  for (let off = 0; off < values.length; off += 500) {
    const chunkVals = values.slice(off, off + 500);
    const chunkParams = [trackId, ...params.slice(1 + off * 3, 1 + (off + 500) * 3)];
    // Platzhalter je Chunk neu nummerieren
    const rebuilt = chunkVals.map((_, k) => {
      const b = 1 + k * 3;
      return `($1, $${b + 1}, $${b + 2}, $${b + 3})`;
    });
    await c.query(
      `INSERT INTO track_route_points (track_id, point_index, x_m, y_m) VALUES ${rebuilt.join(",")}`,
      chunkParams,
    );
  }
}

async function writeMapData(c: pg.PoolClient, mapId: string, p: MapPayload) {
  await c.query("DELETE FROM map_boundary_points WHERE map_id = $1", [mapId]);
  await c.query("DELETE FROM map_blocked_zones WHERE map_id = $1", [mapId]);
  await c.query("DELETE FROM map_images WHERE map_id = $1", [mapId]);

  const boundary = cap(p.boundary, LIMITS.points);
  for (let i = 0; i < boundary.length; i++) {
    const pt = boundary[i];
    await c.query(
      "INSERT INTO map_boundary_points (map_id, point_index, x_m, y_m) VALUES ($1, $2, $3, $4)",
      [mapId, i, pt.x, pt.y],
    );
  }
  const blocked = cap(p.blocked, LIMITS.zones);
  for (let z = 0; z < blocked.length; z++) {
    const zone = await c.query(
      "INSERT INTO map_blocked_zones (map_id, zone_index) VALUES ($1, $2) RETURNING id",
      [mapId, z],
    );
    const zpts = cap(blocked[z], LIMITS.points);
    for (let i = 0; i < zpts.length; i++) {
      const pt = zpts[i];
      await c.query(
        "INSERT INTO map_blocked_zone_points (zone_id, point_index, x_m, y_m) VALUES ($1, $2, $3, $4)",
        [zone.rows[0].id, i, pt.x, pt.y],
      );
    }
  }
  if (p.image) {
    await c.query(
      "INSERT INTO map_images (map_id, data_url, px_width, px_height) VALUES ($1, $2, $3, $4)",
      [mapId, p.image.data, p.image.pxWidth, p.image.pxHeight],
    );
  }
}

async function replaceObstacles(
  c: pg.PoolClient,
  trackId: string,
  clubId: string,
  obstacles: ObstacleDto[],
  customIdMap?: Map<string, string>,
) {
  await c.query("DELETE FROM track_obstacles WHERE track_id = $1", [trackId]);
  const customIds = new Set(
    (await c.query("SELECT id FROM custom_obstacles WHERE club_id = $1", [clubId])).rows.map((r) => r.id),
  );
  const capped = cap(obstacles, LIMITS.obstacles);
  for (let i = 0; i < capped.length; i++) {
    const o = capped[i];
    // template_id immer setzen: bleibt nach ON DELETE SET NULL der
    // Custom-Referenz gültig (CHECK-Constraint) und erhält die Zuordnung
    const mapped = customIdMap?.get(o.templateId) ?? o.templateId;
    const templateId: string | null = mapped ?? null;
    const customId: string | null = customIds.has(mapped) ? mapped : null;
    const row = await c.query(
      `INSERT INTO track_obstacles (track_id, position_index, template_id, custom_obstacle_id, name, x_m, y_m, rotation_deg)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [trackId, i, templateId, customId, o.name ?? "Aufgabe", o.x, o.y, o.rotation ?? 0],
    );
    const opylons = cap(o.pylons, LIMITS.pylons);
    for (let k = 0; k < opylons.length; k++) {
      const p = opylons[k];
      await c.query(
        `INSERT INTO track_obstacle_pylons (obstacle_id, pylon_index, x_m, y_m, lying, angle_deg)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [row.rows[0].id, k, p.x, p.y, !!p.lying, p.angle ?? null],
      );
    }
  }
}

async function insertMap(c: pg.PoolClient, clubId: string, userId: string, p: MapPayload): Promise<string> {
  const row = await c.query(
    `INSERT INTO maps (club_id, name, width_m, height_m, cal_ax, cal_ay, cal_bx, cal_by, cal_ref_len_m, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [
      clubId,
      p.name,
      p.width,
      p.height,
      p.calibration?.a.x ?? null,
      p.calibration?.a.y ?? null,
      p.calibration?.b.x ?? null,
      p.calibration?.b.y ?? null,
      p.calibration?.refLen ?? null,
      userId,
    ],
  );
  await writeMapData(c, row.rows[0].id, p);
  return row.rows[0].id;
}

/* ---------- Router ---------- */

export function dataRouter(): Router {
  const r = express.Router();

  /* Regeln */
  r.get("/rules", async (req, res) => {
    const { rows } = await pool.query(
      "SELECT rule_key, value::float8 AS value FROM club_rules WHERE club_id = $1",
      [req.auth!.clubId],
    );
    res.json(Object.fromEntries(rows.map((x) => [x.rule_key, x.value])));
  });

  r.put("/rules", requireAdmin, async (req, res) => {
    const rules = req.body ?? {};
    await tx(async (c) => {
      await c.query("DELETE FROM club_rules WHERE club_id = $1", [req.auth!.clubId]);
      for (const [key, value] of Object.entries(rules)) {
        if (typeof value !== "number" || !isFinite(value)) continue;
        await c.query("INSERT INTO club_rules (club_id, rule_key, value) VALUES ($1, $2, $3)", [
          req.auth!.clubId,
          key,
          value,
        ]);
      }
    });
    res.status(204).end();
  });

  /* Maps */
  r.get("/maps", async (req, res) => {
    const { rows } = await pool.query(
      `SELECT m.id, m.name, m.width_m::float8 AS width, m.height_m::float8 AS height,
              (mi.map_id IS NOT NULL) AS "hasImage",
              (SELECT count(*) FROM map_boundary_points b WHERE b.map_id = m.id)::int AS "boundaryCount",
              (SELECT count(*) FROM map_blocked_zones z WHERE z.map_id = m.id)::int AS "blockedCount"
       FROM maps m LEFT JOIN map_images mi ON mi.map_id = m.id
       WHERE m.club_id = $1 ORDER BY m.created_at`,
      [req.auth!.clubId],
    );
    res.json(rows);
  });

  r.get("/maps/:id", async (req, res) => {
    res.json(await readMapDetail(pool, req.params.id, req.auth!.clubId));
  });

  r.post("/maps", async (req, res) => {
    const id = await tx((c) => insertMap(c, req.auth!.clubId, req.auth!.userId, req.body));
    res.json(await readMapDetail(pool, id, req.auth!.clubId));
  });

  r.put("/maps/:id", async (req, res) => {
    const p: MapPayload = req.body;
    await tx(async (c) => {
      const owned = await c.query("SELECT 1 FROM maps WHERE id = $1 AND club_id = $2", [
        req.params.id,
        req.auth!.clubId,
      ]);
      if (!owned.rowCount) throw new HttpError(404, "Map nicht gefunden");
      await c.query(
        `UPDATE maps SET name = $2, width_m = $3, height_m = $4,
         cal_ax = $5, cal_ay = $6, cal_bx = $7, cal_by = $8, cal_ref_len_m = $9, updated_at = now()
         WHERE id = $1`,
        [
          req.params.id,
          p.name,
          p.width,
          p.height,
          p.calibration?.a.x ?? null,
          p.calibration?.a.y ?? null,
          p.calibration?.b.x ?? null,
          p.calibration?.b.y ?? null,
          p.calibration?.refLen ?? null,
        ],
      );
      await writeMapData(c, req.params.id, p);
    });
    res.json(await readMapDetail(pool, req.params.id, req.auth!.clubId));
  });

  r.delete("/maps/:id", requireAdmin, async (req, res) => {
    await pool.query("DELETE FROM maps WHERE id = $1 AND club_id = $2", [req.params.id, req.auth!.clubId]);
    res.status(204).end();
  });

  /* Eigene Hindernisse (inkl. Fahrlinien-Varianten und Overrides) */

  async function writeCustomData(
    c: pg.PoolClient,
    id: string,
    pylons: PylonDto[],
    routes: { x: number; y: number }[][] | undefined,
  ) {
    await c.query("DELETE FROM custom_obstacle_pylons WHERE custom_obstacle_id = $1", [id]);
    await c.query("DELETE FROM custom_obstacle_route_points WHERE custom_obstacle_id = $1", [id]);
    for (let i = 0; i < pylons.length; i++) {
      const p = pylons[i];
      await c.query(
        `INSERT INTO custom_obstacle_pylons (custom_obstacle_id, pylon_index, x_m, y_m, lying, angle_deg)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, i, p.x, p.y, !!p.lying, p.angle ?? null],
      );
    }
    const variants = (routes ?? []).filter((v) => Array.isArray(v) && v.length >= 2).slice(0, 10);
    for (let v = 0; v < variants.length; v++) {
      const pts = variants[v].slice(0, 1000);
      for (let i = 0; i < pts.length; i++) {
        await c.query(
          `INSERT INTO custom_obstacle_route_points (custom_obstacle_id, variant_index, point_index, x_m, y_m)
           VALUES ($1, $2, $3, $4, $5)`,
          [id, v, i, pts[i].x, pts[i].y],
        );
      }
    }
  }

  async function readCustomObstacles(clubId: string) {
    const obs = (
      await pool.query(
        "SELECT id, name, base_template_id FROM custom_obstacles WHERE club_id = $1 ORDER BY created_at",
        [clubId],
      )
    ).rows;
    const pylons = (
      await pool.query(
        `SELECT p.custom_obstacle_id AS oid, p.x_m::float8 AS x, p.y_m::float8 AS y, p.lying, p.angle_deg::float8 AS angle
         FROM custom_obstacle_pylons p
         JOIN custom_obstacles o ON o.id = p.custom_obstacle_id
         WHERE o.club_id = $1 ORDER BY p.custom_obstacle_id, p.pylon_index`,
        [clubId],
      )
    ).rows;
    const routePts = (
      await pool.query(
        `SELECT r.custom_obstacle_id AS oid, r.variant_index AS v, r.x_m::float8 AS x, r.y_m::float8 AS y
         FROM custom_obstacle_route_points r
         JOIN custom_obstacles o ON o.id = r.custom_obstacle_id
         WHERE o.club_id = $1 ORDER BY r.custom_obstacle_id, r.variant_index, r.point_index`,
        [clubId],
      )
    ).rows;
    return obs.map((o) => {
      const routes: { x: number; y: number }[][] = [];
      for (const rp of routePts) {
        if (rp.oid !== o.id) continue;
        while (routes.length <= rp.v) routes.push([]);
        routes[rp.v].push({ x: rp.x, y: rp.y });
      }
      return {
        id: o.id,
        name: o.name,
        baseTemplateId: o.base_template_id ?? undefined,
        pylons: pylons
          .filter((p) => p.oid === o.id)
          .map((p) => ({ x: p.x, y: p.y, ...(p.lying ? { lying: true, angle: p.angle ?? 0 } : {}) })),
        routes: routes.length ? routes : undefined,
      };
    });
  }

  r.get("/custom-obstacles", async (req, res) => {
    res.json(await readCustomObstacles(req.auth!.clubId));
  });

  r.post("/custom-obstacles", async (req, res) => {
    const { name, pylons, routes, baseTemplateId } = req.body ?? {};
    if (!name?.trim() || !Array.isArray(pylons) || !pylons.length) {
      throw new HttpError(400, "Name und Pylonen erforderlich");
    }
    const id = await tx(async (c) => {
      // Pro offiziellem Hindernis nur ein Override je Verein
      if (baseTemplateId) {
        await c.query("DELETE FROM custom_obstacles WHERE club_id = $1 AND base_template_id = $2", [
          req.auth!.clubId,
          baseTemplateId,
        ]);
      }
      const row = await c.query(
        "INSERT INTO custom_obstacles (club_id, name, created_by, base_template_id) VALUES ($1, $2, $3, $4) RETURNING id",
        [req.auth!.clubId, name.trim(), req.auth!.userId, baseTemplateId ?? null],
      );
      await writeCustomData(c, row.rows[0].id, pylons, routes);
      return row.rows[0].id as string;
    });
    const all = await readCustomObstacles(req.auth!.clubId);
    res.json(all.find((o) => o.id === id));
  });

  r.put("/custom-obstacles/:id", async (req, res) => {
    const { name, pylons, routes } = req.body ?? {};
    if (!name?.trim() || !Array.isArray(pylons) || !pylons.length) {
      throw new HttpError(400, "Name und Pylonen erforderlich");
    }
    await tx(async (c) => {
      const owned = await c.query("SELECT 1 FROM custom_obstacles WHERE id = $1 AND club_id = $2", [
        req.params.id,
        req.auth!.clubId,
      ]);
      if (!owned.rowCount) throw new HttpError(404, "Hindernis nicht gefunden");
      await c.query("UPDATE custom_obstacles SET name = $2 WHERE id = $1", [req.params.id, name.trim()]);
      await writeCustomData(c, req.params.id, pylons, routes);
    });
    const all = await readCustomObstacles(req.auth!.clubId);
    res.json(all.find((o) => o.id === req.params.id));
  });

  r.delete("/custom-obstacles/:id", async (req, res) => {
    await pool.query("DELETE FROM custom_obstacles WHERE id = $1 AND club_id = $2", [
      req.params.id,
      req.auth!.clubId,
    ]);
    res.status(204).end();
  });

  /* Strecken */
  r.get("/tracks", async (req, res) => {
    const { rows } = await pool.query(
      `SELECT t.id, t.name, extract(epoch FROM t.updated_at) * 1000 AS "updatedAt", m.name AS "mapName",
              m.width_m::float8 AS "mapWidth", m.height_m::float8 AS "mapHeight",
              (SELECT count(*) FROM track_obstacles o WHERE o.track_id = t.id)::int AS "obstacleCount"
       FROM tracks t JOIN maps m ON m.id = t.map_id
       WHERE t.club_id = $1 AND NOT t.is_draft ORDER BY t.updated_at DESC`,
      [req.auth!.clubId],
    );
    res.json(rows.map((x) => ({ ...x, updatedAt: Number(x.updatedAt) })));
  });

  r.get("/tracks/:id", async (req, res) => {
    const t = await pool.query(
      "SELECT id, name, map_id FROM tracks WHERE id = $1 AND club_id = $2 AND NOT is_draft",
      [req.params.id, req.auth!.clubId],
    );
    if (!t.rowCount) throw new HttpError(404, "Strecke nicht gefunden");
    res.json({
      id: t.rows[0].id,
      name: t.rows[0].name,
      map: await readMapDetail(pool, t.rows[0].map_id, req.auth!.clubId),
      obstacles: await readObstacles(pool, t.rows[0].id),
      route: await readRoute(pool, t.rows[0].id),
    });
  });

  r.post("/tracks", async (req, res) => {
    const { id, name, mapId, obstacles, route } = req.body ?? {};
    if (!name?.trim() || !mapId) throw new HttpError(400, "Name und Map erforderlich");
    const trackId = await tx(async (c) => {
      const map = await c.query("SELECT 1 FROM maps WHERE id = $1 AND club_id = $2", [mapId, req.auth!.clubId]);
      if (!map.rowCount) throw new HttpError(404, "Map nicht gefunden");
      let tid: string;
      if (id) {
        const upd = await c.query(
          `UPDATE tracks SET name = $3, map_id = $4, updated_at = now()
           WHERE id = $1 AND club_id = $2 AND NOT is_draft RETURNING id`,
          [id, req.auth!.clubId, name.trim(), mapId],
        );
        if (!upd.rowCount) throw new HttpError(404, "Strecke nicht gefunden");
        tid = upd.rows[0].id;
      } else {
        const ins = await c.query(
          "INSERT INTO tracks (club_id, map_id, name, created_by) VALUES ($1, $2, $3, $4) RETURNING id",
          [req.auth!.clubId, mapId, name.trim(), req.auth!.userId],
        );
        tid = ins.rows[0].id;
      }
      await replaceObstacles(c, tid, req.auth!.clubId, obstacles ?? []);
      await writeRoute(c, tid, route);
      return tid;
    });
    res.json({ id: trackId });
  });

  r.delete("/tracks/:id", requireAdmin, async (req, res) => {
    await pool.query("DELETE FROM tracks WHERE id = $1 AND club_id = $2 AND NOT is_draft", [
      req.params.id,
      req.auth!.clubId,
    ]);
    res.status(204).end();
  });

  /* Arbeitsstand (Entwurf, einer je Nutzer) */
  r.get("/draft", async (req, res) => {
    const t = await pool.query("SELECT id, name, map_id FROM tracks WHERE created_by = $1 AND is_draft", [
      req.auth!.userId,
    ]);
    if (!t.rowCount) return res.json(null);
    res.json({
      name: t.rows[0].name,
      map: await readMapDetail(pool, t.rows[0].map_id, req.auth!.clubId),
      obstacles: await readObstacles(pool, t.rows[0].id),
      route: await readRoute(pool, t.rows[0].id),
    });
  });

  r.put("/draft", async (req, res) => {
    const { mapId, name, obstacles, route } = req.body ?? {};
    if (!mapId) throw new HttpError(400, "Map erforderlich");
    await tx(async (c) => {
      const map = await c.query("SELECT 1 FROM maps WHERE id = $1 AND club_id = $2", [mapId, req.auth!.clubId]);
      if (!map.rowCount) throw new HttpError(404, "Map nicht gefunden");
      const existing = await c.query("SELECT id FROM tracks WHERE created_by = $1 AND is_draft", [
        req.auth!.userId,
      ]);
      let tid: string;
      if (existing.rowCount) {
        tid = existing.rows[0].id;
        await c.query("UPDATE tracks SET name = $2, map_id = $3, updated_at = now() WHERE id = $1", [
          tid,
          name?.trim() || "Entwurf",
          mapId,
        ]);
      } else {
        const ins = await c.query(
          `INSERT INTO tracks (club_id, map_id, name, is_draft, created_by)
           VALUES ($1, $2, $3, true, $4) RETURNING id`,
          [req.auth!.clubId, mapId, name?.trim() || "Entwurf", req.auth!.userId],
        );
        tid = ins.rows[0].id;
      }
      await replaceObstacles(c, tid, req.auth!.clubId, obstacles ?? []);
      await writeRoute(c, tid, route);
    });
    res.status(204).end();
  });

  /* Wissensdatenbank: Reglement-PDF des Vereins */
  r.get("/wiki", async (req, res) => {
    const { rows } = await pool.query(
      `SELECT filename, extract(epoch FROM uploaded_at) * 1000 AS "uploadedAt",
              ceil(length(data_base64) * 0.75)::int AS "sizeBytes"
       FROM club_documents WHERE club_id = $1 AND kind = 'reglement'`,
      [req.auth!.clubId],
    );
    if (!rows.length) return res.json(null);
    res.json({ ...rows[0], uploadedAt: Number(rows[0].uploadedAt) });
  });

  r.get("/wiki/pdf", async (req, res) => {
    const { rows } = await pool.query(
      "SELECT filename, data_base64 FROM club_documents WHERE club_id = $1 AND kind = 'reglement'",
      [req.auth!.clubId],
    );
    if (!rows.length) throw new HttpError(404, "Kein Reglement hinterlegt");
    const buf = Buffer.from(rows[0].data_base64, "base64");
    res.setHeader("Content-Type", "application/pdf");
    // Härtung gegen Polyglot/aktive Inhalte: kein MIME-Sniffing, sandbox, kein Framing
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; object-src 'self'; sandbox");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Disposition",
      `${req.query.download ? "attachment" : "inline"}; filename="${rows[0].filename.replace(/[^\w.\- ]/g, "")}"`,
    );
    res.send(buf);
  });

  r.put("/wiki/pdf", requireAdmin, async (req, res) => {
    const { filename, data } = req.body ?? {};
    if (!data || typeof data !== "string") throw new HttpError(400, "PDF-Daten fehlen");
    // Plausibilitätsprüfung: Base64 eines PDFs beginnt mit "JVBERi" (%PDF)
    if (!data.startsWith("JVBERi")) throw new HttpError(400, "Datei ist kein PDF");
    if (data.length > 20 * 1024 * 1024) throw new HttpError(400, "PDF ist zu groß (max. ~15 MB)");
    await pool.query(
      `INSERT INTO club_documents (club_id, kind, filename, data_base64, uploaded_at, uploaded_by)
       VALUES ($1, 'reglement', $2, $3, now(), $4)
       ON CONFLICT (club_id, kind)
       DO UPDATE SET filename = EXCLUDED.filename, data_base64 = EXCLUDED.data_base64,
                     uploaded_at = now(), uploaded_by = EXCLUDED.uploaded_by`,
      [req.auth!.clubId, (filename || "Reglement.pdf").slice(0, 200), data, req.auth!.userId],
    );
    res.status(204).end();
  });

  /* Einmalige Übernahme der bisherigen Browser-Daten (localStorage-Migration) */
  r.post("/import", requireAdmin, async (req, res) => {
    const { rules, maps, tracks, customTemplates } = req.body ?? {};
    const counts = { maps: 0, tracks: 0, customTemplates: 0, rules: 0 };

    await tx(async (c) => {
      const clubId = req.auth!.clubId;
      const userId = req.auth!.userId;

      if (rules && typeof rules === "object") {
        for (const [key, value] of Object.entries(rules)) {
          if (typeof value !== "number" || !isFinite(value)) continue;
          await c.query(
            `INSERT INTO club_rules (club_id, rule_key, value) VALUES ($1, $2, $3)
             ON CONFLICT (club_id, rule_key) DO UPDATE SET value = EXCLUDED.value`,
            [clubId, key, value],
          );
          counts.rules++;
        }
      }

      const customIdMap = new Map<string, string>();
      for (const t of cap(customTemplates, LIMITS.maps)) {
        if (!t?.name || !Array.isArray(t.pylons)) continue;
        const row = await c.query(
          "INSERT INTO custom_obstacles (club_id, name, created_by) VALUES ($1, $2, $3) RETURNING id",
          [clubId, t.name, userId],
        );
        const cpylons = cap(t.pylons, LIMITS.pylons);
        for (let i = 0; i < cpylons.length; i++) {
          const p = cpylons[i];
          await c.query(
            `INSERT INTO custom_obstacle_pylons (custom_obstacle_id, pylon_index, x_m, y_m, lying, angle_deg)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [row.rows[0].id, i, p.x, p.y, !!p.lying, p.angle ?? null],
          );
        }
        customIdMap.set(t.id, row.rows[0].id);
        counts.customTemplates++;
      }

      const mapIdMap = new Map<string, string>();
      for (const m of cap(maps, LIMITS.maps)) {
        if (!m?.config) continue;
        const newId = await insertMap(c, clubId, userId, {
          name: m.name ?? m.config.name ?? "Map",
          width: m.config.width,
          height: m.config.height,
          boundary: m.config.boundary,
          blocked: m.config.blocked,
          image: m.image,
          calibration: m.calibration,
        });
        mapIdMap.set(m.id, newId);
        counts.maps++;
      }

      for (const t of cap(tracks, LIMITS.tracks)) {
        if (!t?.map) continue;
        let mapId = t.map.mapId ? mapIdMap.get(t.map.mapId) : undefined;
        if (!mapId) {
          // Strecke auf nicht (mehr) gespeicherter Fläche: Rechteck-Map anlegen
          mapId = await insertMap(c, clubId, userId, {
            name: t.map.name ?? "Fläche",
            width: t.map.width,
            height: t.map.height,
            boundary: t.map.boundary,
            blocked: t.map.blocked,
          });
        }
        const ins = await c.query(
          `INSERT INTO tracks (club_id, map_id, name, created_by, created_at, updated_at)
           VALUES ($1, $2, $3, $4, to_timestamp($5 / 1000.0), to_timestamp($6 / 1000.0)) RETURNING id`,
          [clubId, mapId, t.name ?? "Strecke", userId, t.createdAt ?? Date.now(), t.updatedAt ?? Date.now()],
        );
        await replaceObstacles(c, ins.rows[0].id, clubId, t.obstacles ?? [], customIdMap);
        counts.tracks++;
      }
    });

    res.json(counts);
  });

  return r;
}

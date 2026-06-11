-- Kart Slalom Planner – Datenbankschema (PostgreSQL, 3. Normalform)
--
-- 3NF-Begründung:
--  * Alle Attribute sind atomar (Punkte/Pylonen als eigene Zeilen statt Arrays/JSON).
--  * Keine partiellen Abhängigkeiten: bei zusammengesetzten Schlüsseln
--    (z. B. map_boundary_points) hängen alle Attribute vom GESAMTEN Schlüssel ab.
--  * Keine transitiven Abhängigkeiten: Vereinsname nur in clubs, Map-Maße nur in
--    maps, Nutzerdaten nur in users; alles andere referenziert per Fremdschlüssel.
--  * Pylonen eines Strecken-Hindernisses sind bewusst gespeichert (kein Verstoß):
--    sie sind ein Schnappschuss zum Zeitpunkt des Platzierens – das Regelwerk kann
--    sich später ändern, daher sind sie aus template_id NICHT ableitbar.

CREATE TABLE IF NOT EXISTS clubs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  invite_code text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id       uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name  text NOT NULL,
  role          text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Regel-Parameter je Verein (Schlüssel = Feldname aus dem Reglement-Modell)
CREATE TABLE IF NOT EXISTS club_rules (
  club_id  uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  rule_key text NOT NULL,
  value    numeric(8,3) NOT NULL,
  PRIMARY KEY (club_id, rule_key)
);

-- Fahrflächen (Rechteck oder aus Screenshot mit Maske)
CREATE TABLE IF NOT EXISTS maps (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id       uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  name          text NOT NULL,
  width_m       numeric(7,2) NOT NULL CHECK (width_m > 0),
  height_m      numeric(7,2) NOT NULL CHECK (height_m > 0),
  -- Maßstab-Kalibrierung (Bild-px), nur bei Screenshot-Maps
  cal_ax        numeric(9,2),
  cal_ay        numeric(9,2),
  cal_bx        numeric(9,2),
  cal_by        numeric(9,2),
  cal_ref_len_m numeric(6,2),
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_maps_club ON maps(club_id);

-- Screenshot 1:1 zur Map, separat wegen Größe (Listen bleiben schlank)
CREATE TABLE IF NOT EXISTS map_images (
  map_id    uuid PRIMARY KEY REFERENCES maps(id) ON DELETE CASCADE,
  data_url  text NOT NULL,
  px_width  integer NOT NULL CHECK (px_width > 0),
  px_height integer NOT NULL CHECK (px_height > 0)
);

-- Befahrbarer Bereich als geordnetes Polygon
CREATE TABLE IF NOT EXISTS map_boundary_points (
  map_id      uuid NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  point_index integer NOT NULL,
  x_m         numeric(8,2) NOT NULL,
  y_m         numeric(8,2) NOT NULL,
  PRIMARY KEY (map_id, point_index)
);

-- Sperrzonen (Hindernisse auf der Fläche)
CREATE TABLE IF NOT EXISTS map_blocked_zones (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id     uuid NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  zone_index integer NOT NULL,
  UNIQUE (map_id, zone_index)
);

CREATE TABLE IF NOT EXISTS map_blocked_zone_points (
  zone_id     uuid NOT NULL REFERENCES map_blocked_zones(id) ON DELETE CASCADE,
  point_index integer NOT NULL,
  x_m         numeric(8,2) NOT NULL,
  y_m         numeric(8,2) NOT NULL,
  PRIMARY KEY (zone_id, point_index)
);

-- Eigene Hindernis-Vorlagen je Verein
CREATE TABLE IF NOT EXISTS custom_obstacles (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id    uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  name       text NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_custom_obstacles_club ON custom_obstacles(club_id);

CREATE TABLE IF NOT EXISTS custom_obstacle_pylons (
  custom_obstacle_id uuid NOT NULL REFERENCES custom_obstacles(id) ON DELETE CASCADE,
  pylon_index        integer NOT NULL,
  x_m                numeric(7,2) NOT NULL,
  y_m                numeric(7,2) NOT NULL,
  lying              boolean NOT NULL DEFAULT false,
  angle_deg          numeric(6,1),
  PRIMARY KEY (custom_obstacle_id, pylon_index)
);

-- Strecken; is_draft = automatisch gesicherter Arbeitsstand (einer je Nutzer)
CREATE TABLE IF NOT EXISTS tracks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id    uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  map_id     uuid NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  name       text NOT NULL,
  is_draft   boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tracks_club ON tracks(club_id);
CREATE UNIQUE INDEX IF NOT EXISTS one_draft_per_user ON tracks(created_by) WHERE is_draft;

-- Hindernisse einer Strecke (position_index = Aufgaben-Nummerierung)
CREATE TABLE IF NOT EXISTS track_obstacles (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id           uuid NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  position_index     integer NOT NULL,
  template_id        text,
  custom_obstacle_id uuid REFERENCES custom_obstacles(id) ON DELETE SET NULL,
  name               text NOT NULL,
  x_m                numeric(8,2) NOT NULL,
  y_m                numeric(8,2) NOT NULL,
  rotation_deg       numeric(6,1) NOT NULL DEFAULT 0,
  UNIQUE (track_id, position_index),
  CHECK (template_id IS NOT NULL OR custom_obstacle_id IS NOT NULL)
);

-- Strecken-Route (Fahrlinie): geordnete Punktfolge je Strecke
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS route_source text
  CHECK (route_source IN ('auto', 'drawn'));

CREATE TABLE IF NOT EXISTS track_route_points (
  track_id    uuid NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  point_index integer NOT NULL,
  x_m         numeric(8,2) NOT NULL,
  y_m         numeric(8,2) NOT NULL,
  PRIMARY KEY (track_id, point_index)
);

-- Pylonen-Schnappschuss je Hindernis (siehe 3NF-Begründung oben)
CREATE TABLE IF NOT EXISTS track_obstacle_pylons (
  obstacle_id uuid NOT NULL REFERENCES track_obstacles(id) ON DELETE CASCADE,
  pylon_index integer NOT NULL,
  x_m         numeric(7,2) NOT NULL,
  y_m         numeric(7,2) NOT NULL,
  lying       boolean NOT NULL DEFAULT false,
  angle_deg   numeric(6,1),
  PRIMARY KEY (obstacle_id, pylon_index)
);

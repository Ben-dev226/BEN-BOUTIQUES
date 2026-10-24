const U = "(now() AT TIME ZONE 'utc')";

export const MIGRATIONS: string[] = [
// ───────── 1 : schéma multi-boutiques ─────────
`
CREATE TABLE tenants (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  custom_domain TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  plan TEXT NOT NULL DEFAULT 'free',
  max_products INT NOT NULL DEFAULT 100,
  max_users INT NOT NULL DEFAULT 3,
  paid_until DATE,
  created_at TIMESTAMP NOT NULL DEFAULT ${U}
);
CREATE TABLE super_admins (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT ${U}
);
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'manager' CHECK (role IN ('admin','manager')),
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT ${U}
);
CREATE UNIQUE INDEX users_tenant_username ON users (tenant_id, lower(username));
CREATE TABLE categories (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '',
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT ${U},
  UNIQUE (tenant_id, slug)
);
CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price INT NOT NULL CHECK (price >= 0),
  compare_price INT CHECK (compare_price IS NULL OR compare_price >= 0),
  sku TEXT NOT NULL DEFAULT '',
  category_id INT REFERENCES categories(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','draft','archived')),
  is_new BOOLEAN NOT NULL DEFAULT FALSE,
  featured BOOLEAN NOT NULL DEFAULT FALSE,
  track_stock BOOLEAN NOT NULL DEFAULT FALSE,
  stock INT NOT NULL DEFAULT 0 CHECK (stock >= 0),
  views INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT ${U},
  updated_at TIMESTAMP NOT NULL DEFAULT ${U},
  UNIQUE (tenant_id, slug)
);
CREATE INDEX products_list ON products (tenant_id, status, id DESC);
CREATE INDEX products_cat ON products (category_id);
CREATE TABLE product_images (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  thumb TEXT NOT NULL,
  width INT NOT NULL DEFAULT 0,
  height INT NOT NULL DEFAULT 0,
  alt TEXT NOT NULL DEFAULT '',
  position INT NOT NULL DEFAULT 0
);
CREATE INDEX images_product ON product_images (product_id, position);
CREATE TABLE product_variants (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  sku TEXT NOT NULL DEFAULT '',
  price INT CHECK (price IS NULL OR price >= 0),
  stock INT NOT NULL DEFAULT 0 CHECK (stock >= 0),
  position INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX variants_product ON product_variants (product_id, position);
CREATE TABLE customers (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT ${U},
  UNIQUE (tenant_id, phone)
);
CREATE TABLE promo_codes (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('percent','fixed')),
  value INT NOT NULL CHECK (value > 0),
  min_order INT NOT NULL DEFAULT 0,
  max_uses INT,
  used INT NOT NULL DEFAULT 0,
  starts_at TIMESTAMP,
  expires_at TIMESTAMP,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT ${U}
);
CREATE UNIQUE INDEX promo_tenant_code ON promo_codes (tenant_id, lower(code));
CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  number TEXT NOT NULL,
  customer_id INT REFERENCES customers(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_address TEXT NOT NULL DEFAULT '',
  delivery_mode TEXT NOT NULL DEFAULT 'delivery' CHECK (delivery_mode IN ('delivery','pickup')),
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','confirmed','shipped','delivered','cancelled')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','paid')),
  payment_method TEXT NOT NULL DEFAULT 'cod',
  subtotal INT NOT NULL,
  discount INT NOT NULL DEFAULT 0,
  delivery_fee INT NOT NULL DEFAULT 0,
  total INT NOT NULL,
  promo_code TEXT NOT NULL DEFAULT '',
  admin_note TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT ${U},
  updated_at TIMESTAMP NOT NULL DEFAULT ${U},
  UNIQUE (tenant_id, number)
);
CREATE INDEX orders_list ON orders (tenant_id, status, created_at DESC);
CREATE INDEX orders_phone ON orders (tenant_id, customer_phone);
CREATE TABLE order_items (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INT REFERENCES products(id) ON DELETE SET NULL,
  variant_id INT REFERENCES product_variants(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  variant_label TEXT NOT NULL DEFAULT '',
  unit_price INT NOT NULL,
  qty INT NOT NULL CHECK (qty > 0),
  image TEXT NOT NULL DEFAULT ''
);
CREATE INDEX items_order ON order_items (order_id);
CREATE INDEX items_product ON order_items (product_id);
CREATE TABLE order_events (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  username TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT ${U}
);
CREATE INDEX events_order ON order_events (order_id);
CREATE TABLE settings (
  tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  k TEXT NOT NULL,
  v TEXT NOT NULL,
  PRIMARY KEY (tenant_id, k)
);
CREATE TABLE rate_limits (k TEXT NOT NULL, ts BIGINT NOT NULL);
CREATE INDEX rate_k ON rate_limits (k, ts);
CREATE TABLE audit_log (
  id SERIAL PRIMARY KEY,
  tenant_id INT REFERENCES tenants(id) ON DELETE CASCADE,
  user_id INT,
  username TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL DEFAULT '',
  entity_id TEXT,
  detail TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT ${U}
);
CREATE INDEX audit_list ON audit_log (tenant_id, id DESC);
`,
// ───────── 2 : paiements d'abonnement (Chariow) ─────────
`
CREATE TABLE billing_payments (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sale_id TEXT NOT NULL UNIQUE,
  delivery_id TEXT,
  product_id TEXT NOT NULL DEFAULT '',
  months INT NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT '',
  paid_until_before DATE,
  paid_until_after DATE NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT ${U}
);
CREATE INDEX billing_tenant ON billing_payments (tenant_id, id DESC);
`,
// ───────── 3 : checkouts en attente (rapprochement de secours par email) ─────────
`
CREATE TABLE billing_checkouts (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  product_id TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT ${U}
);
CREATE INDEX billing_checkouts_email ON billing_checkouts (lower(email), id DESC);
`,
// ───────── 4 : journal d'événements de la plateforme (monitoring / sécurité) ─────────
`
CREATE TABLE platform_events (
  id BIGSERIAL PRIMARY KEY,
  level TEXT NOT NULL CHECK (level IN ('info','warn','error','security')),
  type TEXT NOT NULL,
  tenant_id INT REFERENCES tenants(id) ON DELETE SET NULL,
  message TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT ${U}
);
CREATE INDEX events_recent ON platform_events (id DESC);
CREATE INDEX events_level ON platform_events (level, id DESC);
CREATE INDEX events_type ON platform_events (type, created_at DESC);
`,
// ───────── 5 : sauvegardes + état de la plateforme ─────────
`
CREATE TABLE backups (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMP NOT NULL DEFAULT ${U},
  trigger TEXT NOT NULL DEFAULT 'manual',
  file_name TEXT NOT NULL DEFAULT '',
  bytes BIGINT NOT NULL DEFAULT 0,
  row_count INT NOT NULL DEFAULT 0,
  encrypted BOOLEAN NOT NULL DEFAULT FALSE,
  ok BOOLEAN NOT NULL DEFAULT FALSE,
  remote_ok BOOLEAN NOT NULL DEFAULT FALSE,
  destinations TEXT NOT NULL DEFAULT '[]',
  error TEXT NOT NULL DEFAULT '',
  duration_ms INT NOT NULL DEFAULT 0
);
CREATE INDEX backups_recent ON backups (id DESC);
CREATE TABLE platform_state (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at TIMESTAMP NOT NULL DEFAULT ${U});
`,
// ───────── 6 : compactage des vieilles commandes (on garde les chiffres, on retire le détail) ─────────
`
ALTER TABLE orders ADD COLUMN compacted_at TIMESTAMP;
CREATE INDEX orders_to_compact ON orders (created_at) WHERE compacted_at IS NULL AND status IN ('delivered','cancelled');
-- ventes par mois et par produit des commandes compactées (statistiques conservées)
CREATE TABLE sales_archive (
  tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  month DATE NOT NULL,
  product_key TEXT NOT NULL,
  product_id INT,
  name TEXT NOT NULL,
  category_name TEXT NOT NULL DEFAULT 'Sans catégorie',
  qty INT NOT NULL DEFAULT 0,
  revenue BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, month, product_key)
);
-- totaux mensuels des commandes supprimées en dernier recours
CREATE TABLE orders_monthly (
  tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  month DATE NOT NULL,
  orders INT NOT NULL DEFAULT 0,
  cancelled INT NOT NULL DEFAULT 0,
  revenue BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, month)
);
`,
// ───────── 7 : double authentification (TOTP) du super-admin ─────────
`
ALTER TABLE super_admins ADD COLUMN totp_secret TEXT;
ALTER TABLE super_admins ADD COLUMN totp_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE super_admins ADD COLUMN totp_last BIGINT NOT NULL DEFAULT 0;
`,
// ───────── 8 : analytiques intégrés (compteurs agrégés, sans données personnelles) ─────────
`
CREATE TABLE stats_daily (
  tenant_id INT NOT NULL,            -- 0 = landing de la plateforme
  day DATE NOT NULL,
  metric TEXT NOT NULL,              -- pv, uv, prod, cart, checkout, src, dev, click
  ref TEXT NOT NULL DEFAULT '',
  n INT NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, day, metric, ref)
);
`,
// ───────── 9 : rapports enregistrés par boutique ─────────
`
CREATE TABLE saved_reports (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  config TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT ${U}
);
CREATE INDEX saved_reports_tenant ON saved_reports (tenant_id);
`,
// ───────── 10 : mesures de performance et de disponibilité (agrégées par heure) ─────────
`
CREATE TABLE perf_hourly (
  hour TIMESTAMP NOT NULL,
  key TEXT NOT NULL,                 -- api:<route>, db, health, beacon
  n INT NOT NULL DEFAULT 0,
  errors INT NOT NULL DEFAULT 0,
  sum_ms BIGINT NOT NULL DEFAULT 0,
  max_ms INT NOT NULL DEFAULT 0,
  b0 INT NOT NULL DEFAULT 0, b1 INT NOT NULL DEFAULT 0, b2 INT NOT NULL DEFAULT 0, b3 INT NOT NULL DEFAULT 0, b4 INT NOT NULL DEFAULT 0, b5 INT NOT NULL DEFAULT 0, b6 INT NOT NULL DEFAULT 0,
  PRIMARY KEY (hour, key)
);
`,
// ───────── 11 : demandes d'inscription de nouvelles boutiques ─────────
`
CREATE TABLE signup_requests (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  whatsapp TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  tenant_id INT,
  ip TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT ${U},
  decided_at TIMESTAMP
);
CREATE INDEX signup_status ON signup_requests (status, created_at);
`,
// ───────── 12 : modération des boutiques (blocage, bannissement, suppression programmée) ─────────
`
ALTER TABLE tenants ADD COLUMN blocked_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE tenants ADD COLUMN blocked_at TIMESTAMP;
ALTER TABLE tenants ADD COLUMN banned BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tenants ADD COLUMN ban_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE tenants ADD COLUMN banned_at TIMESTAMP;
ALTER TABLE tenants ADD COLUMN delete_after TIMESTAMP;
CREATE TABLE banlist (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('slug','whatsapp','email')),
  value TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  tenant_slug TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT ${U},
  UNIQUE (kind, value)
);
`,
// ───────── 13 : compteur « boutiques créées à vie » fiable (une séquence peut sauter jusqu'à 32 valeurs après un incident) ─────────
`
INSERT INTO platform_state (k, v) SELECT 'shops_created', GREATEST((SELECT COUNT(*) FROM tenants), (SELECT CASE WHEN is_called THEN last_value ELSE 0 END FROM tenants_id_seq))::text ON CONFLICT (k) DO NOTHING;
`,
];

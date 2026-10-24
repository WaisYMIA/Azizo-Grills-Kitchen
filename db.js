const Database = require('better-sqlite3');
const path = require('path');
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'azizo.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY, category_group TEXT NOT NULL, cat TEXT NOT NULL, kind TEXT,
    name TEXT NOT NULL, desc TEXT, price INTEGER NOT NULL, unit TEXT NOT NULL,
    img TEXT, badges TEXT, origin TEXT, updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER, customer_name TEXT,
    customer_phone TEXT NOT NULL, fulfilment TEXT NOT NULL, branch TEXT, pickup_time TEXT,
    delivery_address TEXT, delivery_lat REAL, delivery_lng REAL, delivery_fee INTEGER DEFAULT 0,
    payment_method TEXT NOT NULL, mpesa_receipt TEXT, promo_code TEXT,
    items_subtotal INTEGER NOT NULL, total INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'received', created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id TEXT, name TEXT NOT NULL, qty INTEGER NOT NULL, unit TEXT,
    unit_price INTEGER NOT NULL, line_total INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS branches (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, area TEXT, address TEXT, query TEXT,
    lat REAL, lng REAL, phone TEXT DEFAULT '', hours TEXT DEFAULT 'Open 24 hours',
    is_main INTEGER NOT NULL DEFAULT 0, listed INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0, updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS mpesa_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER REFERENCES orders(id),
    checkout_request_id TEXT, phone TEXT, amount INTEGER, status TEXT DEFAULT 'pending',
    mpesa_receipt TEXT, raw_callback TEXT, created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Stock switch used by staff.html ("sold out" hides the Add button on the site). Older databases get the column once.
if (!db.prepare('PRAGMA table_info(products)').all().some(c => c.name === 'in_stock')) {
  db.exec('ALTER TABLE products ADD COLUMN in_stock INTEGER NOT NULL DEFAULT 1');
}

// ---- Reporting support (v1.2) ----
// cost_price = what a unit costs Azizo to buy/prepare (KSh per kg/bird/plate). It is optional:
// blank (0) means "not set yet" and the reports then say margins are incomplete instead of guessing.
if (!db.prepare('PRAGMA table_info(products)').all().some(c => c.name === 'cost_price')) {
  db.exec('ALTER TABLE products ADD COLUMN cost_price INTEGER NOT NULL DEFAULT 0');
}
// Each sold line keeps the cost that applied on the day, so later cost changes never rewrite history.
if (!db.prepare('PRAGMA table_info(orders)').all().some(c => c.name === 'notes')) {
  db.exec('ALTER TABLE orders ADD COLUMN notes TEXT');
}
for (const col of ['area', 'recurring']) {
  if (!db.prepare('PRAGMA table_info(orders)').all().some(c => c.name === col)) db.exec(`ALTER TABLE orders ADD COLUMN ${col} TEXT`);
}
if (!db.prepare('PRAGMA table_info(order_items)').all().some(c => c.name === 'cost_price')) {
  db.exec('ALTER TABLE order_items ADD COLUMN cost_price INTEGER NOT NULL DEFAULT 0');
}
db.exec(`
  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT, expense_date TEXT NOT NULL, category TEXT NOT NULL,
    description TEXT, amount INTEGER NOT NULL, branch TEXT, paid_via TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS order_status_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, status TEXT NOT NULL,
    changed_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
  CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);
  CREATE INDEX IF NOT EXISTS idx_statuslog_order ON order_status_log(order_id);
`);

// First-run seed: the live menu as of this build, so a fresh deploy (new database,
// no products.json, no GitHub sync) still serves a real, usable catalog immediately
// instead of an empty one. Only runs when the table is empty — never overwrites
// products you've since added, edited, or deleted through the admin tool.
// Photos are simple original placeholder icons (site/images/*.svg) built for this
// project, bundled as real local files — no internet connection needed to see them.
// Swap them for real product photos any time via admin.html's uploader.
// The built-in menu. Photos are simple original placeholder icons (site/images/*.svg) built
// for this project, bundled as real local files — no internet connection needed to see them.
// Swap them for real product photos any time via admin.html's uploader.
// Row: [id, section, category, kind, name, description, price, unit, image, badges?]
const seedRows = [
  ['f1','fresh','Beef','red','Beef Rump','Lean, tender cut with good beef flavour. Great for nyama choma, grilled steaks or a quick mchuzi. Tell us the thickness you want.',650,'kg','beef-raw.svg'],
  ['f2','fresh','Beef','red','Beef Ribeye','Well-marbled steak that stays rich and juicy. Sear on a hot pan or charcoal, then rest it a few minutes before slicing.',850,'kg','beef-raw.svg'],
  ['f3','fresh','Beef','red','Beef Mince','Freshly minced beef for stews, burgers, samosas and meatballs. Cooks quickly and takes up spices well.',600,'kg','beef-raw.svg'],
  ['f4','fresh','Pork','red','Pork Chops','Bone-in chops, trimmed and ready to marinate. Lovely fried, grilled or baked with garlic and herbs.',700,'kg','pork-raw.svg'],
  ['f5','fresh','Pork','red','Pork Ribs','Meaty rack for slow grilling or baking. Marinate overnight, then cook low and slow until the meat comes off the bone.',750,'kg','pork-raw.svg'],
  ['f6','fresh','Chicken','white','Broiler Chicken (Whole)','Whole broiler, cleaned and ready to cook. The everyday choice for roasting, frying or a family kuku mchuzi.',550,'bird','chicken-raw.svg'],
  ['f7','fresh','Chicken','white','Chicken Breast','Skinless, boneless fillets. Lean and quick to cook — good for grilling, stir-fry or slicing into sandwiches.',520,'kg','chicken-raw.svg'],
  ['f8','fresh','Fish','white','Tilapia (Whole)','Fresh whole tilapia, scaled and gutted on request. Fry it crisp or grill with lemon, and serve with ugali and kachumbari.',450,'kg','fish-raw.svg'],
  ['f9','fresh','Fish','white','Nile Perch Fillet','Boneless white fillet with a mild taste. Pan-fry, grill or simmer in coconut sauce — no bones to worry about.',700,'kg','fish-raw.svg'],
  ['r1','ready','Grilled',null,'Nyama Choma (Beef)','Charcoal-grilled beef, chopped and served hot. Add kachumbari and ugali for the full nyama choma plate.',700,'kg','grilled.svg'],
  ['r2','ready','Grilled',null,'Grilled Chicken','Half or whole chicken, marinated and grilled over charcoal to order. Smoky, juicy and served hot.',600,'half','grilled.svg'],
  ['r3','ready','Fried',null,'Fried Chicken','Crispy fried chicken pieces, made fresh to order. Best with chips and kachumbari.',550,'plate','fried.svg'],
  ['r4','ready','Fried',null,'Fried Fish','Whole or filleted tilapia, deep-fried until crisp. Served with ugali, kachumbari and lemon.',500,'plate','fried.svg'],
  ['r5','ready','Shawarma',null,'Beef Shawarma','Tender beef, fresh salad and house sauce in a warm wrap. A filling meal you can eat on the go.',350,'wrap','shawarma.svg'],
  ['r6','ready','Shawarma',null,'Chicken Shawarma','Tender chicken, fresh salad and house sauce in a warm wrap. A filling meal you can eat on the go.',320,'wrap','shawarma.svg'],
  ['f10','fresh','Beef','red','Sirloin Steak','Tender steak with a thin strip of fat for flavour. Best seared quickly on a hot grill or pan, then rested.',900,'kg','beef-raw.svg'],
  ['f11','fresh','Beef','red','T-Bone Steak','Two steaks in one — soft fillet and firmer sirloin, divided by the T-shaped bone. Cook it thick over charcoal for a proper weekend braai.',950,'kg','beef-raw.svg'],
  ['f12','fresh','Beef','red','Topside Steak','Lean, good-value cut. Slice thin for stir-fry, or roast and slow-cook until soft.',750,'kg','beef-raw.svg'],
  ['f13','fresh','Beef','red','Beef Short Ribs','Meaty beef ribs cut across the bone. Braise slowly in a mchuzi, or grill until sticky and tender.',700,'kg','beef-raw.svg'],
  ['f14','fresh','Beef','red','Oxtail','Rich and full of flavour. Simmer slowly for a few hours until the meat falls off the bone — best with rice or chapati.',800,'kg','beef-raw.svg'],
  ['f15','fresh','Beef','red','Beef Liver','Fresh liver, trimmed and ready. Slice and fry with onions for a quick meal; don\'t overcook or it turns hard.',550,'kg','beef-raw.svg'],
  ['f16','fresh','Beef','red','Beef Soup Bones','Beef bones with marrow for a rich supu. Simmer for a few hours with ginger, garlic and onions.',250,'kg','beef-raw.svg'],
  ['f17','fresh','Chicken','white','Chicken Thighs','Juicy bone-in thighs, skin on. They stay moist when grilled, fried or simmered, so they are hard to overcook.',600,'kg','chicken-raw.svg'],
  ['f18','fresh','Chicken','white','Chicken Drumsticks','Whole drumsticks, farm fresh. A family favourite — roast, fry or grill, and the kids will ask for more.',550,'kg','chicken-raw.svg'],
  ['f19','fresh','Chicken','white','Chicken Wings','Meaty wings for grilling or deep-frying. Marinate with garlic, lemon and a little pilipili for the best flavour.',500,'kg','chicken-raw.svg'],
  ['f20','fresh','Chicken','white','Chicken Liver','Fresh liver, cleaned and ready. Soft and quick to cook — fry with onions and dhania.',350,'kg','chicken-raw.svg'],
  ['f21','fresh','Chicken','white','Gizzard','Cleaned chicken gizzard with a firm bite. Boil until tender, then fry or add to a stew.',400,'kg','chicken-raw.svg'],
  ['f22','fresh','Fish','white','Prawns','Fresh prawns, cleaned and deveined. They cook in minutes — garlic, butter and lemon is all they need.',1800,'kg','fish-raw.svg'],
  ['f23','fresh','Fish','white','Salmon Fillet','Boneless imported salmon fillet, rich and soft. Pan-sear skin side down or bake with lemon and herbs.',3500,'kg','fish-raw.svg'],
  ['f24','fresh','Fish','white','Omena (Dagaa)','Sun-dried omena, a Kenyan favourite. Wash well and fry with onions and tomatoes; serve with ugali and sukuma wiki.',400,'kg','fish-raw.svg'],
  ['f25','fresh','Goat',null,'Goat Ribs','Goat ribs, bone-in and cut for nyama choma. Roast slowly over charcoal and serve with kachumbari.',800,'kg','goat-raw.svg'],
  ['f26','fresh','Goat',null,'Goat Meat (Mbuzi)','Cubed mbuzi, ready for the pot or the grill. Boil until tender, then fry or stew.',750,'kg','goat-raw.svg'],
  ['f27','fresh','Goat',null,'Mutton/Lamb Chops','Tender chops cut to order. Grill or pan-fry with salt, garlic and a little rosemary.',950,'kg','goat-raw.svg'],
  ['g1','groceries','Vegetables',null,'Tomatoes','Fresh, ripe tomatoes for kachumbari and the base of any mchuzi.',120,'kg','veggies.svg'],
  ['g2','groceries','Vegetables',null,'Onions','Red onions — the starting point of almost every Kenyan stew and fry.',100,'kg','veggies.svg'],
  ['g3','groceries','Vegetables',null,'Dhania (Coriander)','Fresh dhania, sold by the bunch. Add near the end of cooking for aroma and colour.',30,'bunch','veggies.svg'],
  ['g4','groceries','Vegetables',null,'Pilipili (Chili)','Fresh pilipili, green or red. Use sparingly in kachumbari, marinades and sauces.',50,'250g','veggies.svg'],
  ['g5','groceries','Vegetables',null,'Lemon','Fresh lemons. Squeeze over grilled fish or chicken, or into a marinade.',15,'piece','veggies.svg'],
  ['g6','groceries','Vegetables',null,'Potatoes','Fresh potatoes for chips, mashed potato or to give a stew more body.',90,'kg','veggies.svg'],
  ['g7','groceries','Vegetables',null,'Kachumbari Mix','Pre-chopped tomato, onion and dhania, ready to serve with nyama choma, chips or ugali.',150,'pack','veggies.svg'],
  ['g8','groceries','Spices',null,'Garlic','Fresh garlic bulbs for marinades, stews and soups.',200,'250g','spices.svg'],
  ['g9','groceries','Spices',null,'Ginger','Fresh ginger root. Good in tea, marinades and broths.',150,'250g','spices.svg'],
  ['g10','groceries','Spices',null,'Royco / Meat Masala','All-purpose seasoning for stews, grills and fried meat. A little goes a long way.',80,'packet','spices.svg'],
  ['g11','groceries','Spices',null,'Cooking Oil','Vegetable cooking oil, 1 litre. For frying, sautéing and deep-frying.',280,'litre','spices.svg'],
  ['g12','groceries','Spices',null,'Salt','Table salt, 1kg packet.',50,'packet','spices.svg'],
  ['f28','fresh','Chicken','white','Kienyeji Chicken (Whole)','Free-range kienyeji chicken, slow-grown and firmer. It takes longer to cook, but gives the deep flavour of a traditional mchuzi.',1200,'bird','chicken-raw.svg',['Free-Range']],
  ['f29','fresh','Fish','white','Smoked Fish (Tilapia)','Tilapia smoked over firewood the traditional way. Flake it into stew, ugali or managu, or enjoy it as it is.',600,'kg','fish-raw.svg'],
  ['f30','fresh','Fish','white','Omena (Fresh/Wet)','Fresh, undried omena. Fry the same day with onions, or add straight to the pot — soft and quick to cook.',250,'kg','fish-raw.svg'],
  ['r7','ready','Fried',null,'Fried Omena (Crispy Dagaa)','Crispy fried omena — salty, crunchy and hot. A classic with ugali, or a snack with a cold drink.',300,'plate','fried.svg'],
  ['r8','ready','Grilled',null,'Grilled Kienyeji Chicken','Half or whole kienyeji chicken, marinated and charcoal-grilled. Firmer meat and richer flavour than broiler.',750,'half','grilled.svg',['Free-Range']],
  ['g13','groceries','Eggs',null,'Eggs (Tray of 30)','Standard eggs, tray of 30. For breakfast, baking or mayai pasua.',450,'tray','eggs.svg'],
  ['g14','groceries','Eggs',null,'Kienyeji Eggs (Tray of 30)','Free-range kienyeji eggs, tray of 30. Smaller, with richer yolks — the ones many households ask for by name.',650,'tray','eggs.svg',['Free-Range']],
];

// Menu additions made after the first release. Prices here are sensible starting points,
// not final — set your real ones in admin.html.
const catalogV2Rows = [
  ["f31","fresh","Sausages","red","Beef Sausages","Juicy beef sausages for breakfast, a braai or a quick stew. Grill, pan-fry or boil.",700,"kg","sausages.svg"],
  ["f32","fresh","Sausages","red","Pork Sausages","Seasoned pork sausages with a good fat balance. Great on the grill or in the frying pan.",750,"kg","sausages.svg"],
  ["f33","fresh","Sausages","red","Smokies (Pack of 10)","Small smoked sausages — the Kenyan street-food favourite. Make smokie pasua, or pack them in a lunchbox.",350,"pack","sausages.svg"],
  ["f34","fresh","Packs","red","Beef Stew Pack","1kg diced beef with tomatoes, onions and fresh dhania. Everything for a family mchuzi in one add-to-cart.",780,"pack","pack.svg"],
  ["f35","fresh","Packs",null,"Goat Stew Pack (Mbuzi)","1kg mbuzi cut for the pot, with tomatoes, onions and dhania. Simmer slowly for a rich stew.",850,"pack","pack.svg"],
  ["f36","fresh","Packs","white","Chicken Stew Pack","A whole broiler cut up for stewing, with tomatoes, onions and dhania. Dinner sorted.",650,"pack","pack.svg"],
  ["f37","fresh","Packs","white","Tilapia Fry Basket","1kg whole tilapia, scaled and gutted, with lemons, tomatoes, onions and dhania. Fry it and make kachumbari to match.",550,"basket","pack.svg"],
  ["f38","fresh","Packs","white","Fish Lover's Basket","1kg whole tilapia plus ½kg fresh omena and lemons. Two favourites in one basket.",700,"basket","pack.svg"],
  ["f39","fresh","Packs","red","Bone Broth Bundle","1kg beef soup bones with fresh ginger and garlic. Simmer for hours for a warming supu on a cold evening.",380,"bundle","pack.svg"],
  ["r9","ready","Grilled",null,"Smokie Pasua","A grilled smokie split open and topped with fresh kachumbari. The classic Kenyan street bite.",100,"piece","grilled.svg"],
  ["r10","ready","Grilled",null,"Grilled Beef Sausage","Beef sausage charcoal-grilled to order and served with kachumbari.",150,"piece","grilled.svg"],
];

// How databases created earlier catch up with the menu: each time CATALOG_VERSION goes up,
// a database that already has products gets the newer rows added ONCE (never overwriting a
// row that exists, and never re-adding on later restarts — so an item you delete in admin
// afterwards stays deleted). A brand-new database simply gets everything at first start.
const CATALOG_VERSION = 3;
const V1_IDS = ['f28','f29','f30','r7','r8','g13','g14']; // the kienyeji / fish / eggs additions
// v3: friendlier product descriptions. An existing database only gets the new wording for an item
// whose description is STILL exactly the old built-in text — anything you rewrote in admin is left alone.
const OLD_DESCS = {"f1": "Lean, tender cut ideal for grilling or roasting. Cut to your preferred thickness.","f2": "Well-marbled steak cut, perfect for the grill.","f3": "Freshly ground beef, great for stews and burgers.","f4": "Bone-in chops, trimmed and ready to marinate.","f5": "Full rack, ideal for slow grilling.","f6": "Standard commercial broiler, farm-fresh, cleaned and ready to cook — the everyday choice.","f7": "Skinless, boneless fillets.","f8": "Fresh whole tilapia, scaled and gutted on request.","f9": "Boneless fillet, ready for the pan or grill.","f10": "Tender, well-trimmed steak cut, great seared or grilled.","f11": "Classic bone-in steak with fillet and sirloin on either side.","f12": "Lean, economical cut — ideal for roasting or slow cooking.","f13": "Flanken-style ribs, great for braising or the grill.","f14": "Rich, gelatinous cut — a classic for slow-cooked stew.","f15": "Fresh beef liver, trimmed and ready to cook.","f16": "Marrow bones for a rich, home-style bone broth.","f17": "Juicy bone-in thighs, skin on.","f18": "Whole drumsticks, farm fresh.","f19": "Great for grilling or deep-frying.","f20": "Fresh chicken liver, cleaned and ready.","f21": "Cleaned chicken gizzard.","f22": "Fresh prawns, cleaned and deveined.","f23": "Boneless imported salmon fillet.","f24": "Sun-dried silver cyprinid, a Kenyan favourite.","f25": "Ribs cut for nyama choma, bone-in.","f26": "Cubed goat meat, ready for stew or grill.","f27": "Tender chops, cut to order.","f28": "Free-range, slow-grown kienyeji chicken — firmer texture and the deeper flavour Kenyan households and hotels pay a premium for.","f29": "Whole tilapia smoked over firewood the traditional way — ready to flake straight into stew, ugali or managu.","f30": "Undried fresh dagaa — for frying at home the same day, or straight into the pot.","f31": "Juicy beef sausages — grill, pan-fry or boil for breakfast, a braai or a quick stew.","f32": "Seasoned pork sausages with a good fat balance — made for the grill and the frying pan.","f33": "Small smoked sausages — the Kenyan street-food favourite, for smokie pasua or a lunchbox treat.","f34": "1kg diced beef with tomatoes, onions and fresh dhania — everything for a family stew, one add-to-cart.","f35": "1kg goat meat cut for the pot, with tomatoes, onions and dhania — ready for a slow, rich stew.","f36": "A whole broiler cut up for stewing, with tomatoes, onions and dhania — dinner sorted.","f37": "1kg whole tilapia, scaled and gutted, with lemons, tomatoes, onions and dhania for kachumbari.","f38": "1kg whole tilapia plus ½kg fresh omena and lemons — one basket, two favourites.","f39": "1kg beef soup bones with fresh ginger and garlic — the start of a proper, restorative broth.","r1": "Charcoal-grilled beef, served with kachumbari on request.","r2": "Half or whole, marinated and grilled to order.","r3": "Crispy fried chicken pieces, made fresh to order.","r4": "Deep-fried tilapia, whole or filleted.","r5": "Wrapped shawarma with beef, salad and house sauce.","r6": "Wrapped shawarma with chicken, salad and house sauce.","r7": "Crispy deep-fried dagaa, a Kenyan favourite bar snack and ugali side — served hot and salty.","r8": "Half or whole kienyeji bird, marinated and charcoal-grilled — firmer meat and richer flavour than broiler.","r9": "A grilled smokie split open and loaded with fresh kachumbari — the classic Kenyan street bite.","r10": "Beef sausage charcoal-grilled to order, served with kachumbari.","g1": "Fresh tomatoes — kachumbari and stew base.","g2": "Red onions, essential for any meat dish.","g3": "Fresh coriander, sold by the bunch.","g4": "Fresh green or red chili, for kachumbari or marinades.","g5": "Fresh lemons — great on grilled fish or chicken.","g6": "Fresh potatoes — chips or a stew side.","g7": "Pre-chopped tomato, onion and coriander — ready to serve.","g8": "Fresh garlic bulbs.","g9": "Fresh ginger root.","g10": "All-purpose seasoning for stews and grills.","g11": "Vegetable cooking oil, 1 litre.","g12": "Table salt, 1kg packet.","g13": "Standard commercial eggs, tray of 30 — for breakfast, baking or mayai pasua.","g14": "Free-range kienyeji eggs — smaller, richer yolk, the ones households ask for by name."};
const BROILER_NAME = 'Broiler Chicken (Whole)';
const BROILER_DESC = 'Standard commercial broiler, farm-fresh, cleaned and ready to cook — the everyday choice.';

db.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`);
const metaGet = (k) => { const r = db.prepare('SELECT value FROM meta WHERE key = ?').get(k); return r ? r.value : null; };
const metaSet = (k, v) => db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, String(v));

const insertSeed = db.prepare(`
  INSERT OR IGNORE INTO products (id, category_group, cat, kind, name, desc, price, unit, img, badges, origin)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '')
`);
const runSeed = (row) => {
  const [id, group, cat, kind, name, desc, price, unit, img, badges] = row;
  insertSeed.run(id, group, cat, kind, name, desc, price, unit, img, JSON.stringify(badges || []));
};

const productCount = db.prepare('SELECT COUNT(*) AS n FROM products').get().n;
if (productCount === 0) {
  db.transaction(() => {
    seedRows.forEach(runSeed);
    catalogV2Rows.forEach(runSeed);
    metaSet('catalog_version', CATALOG_VERSION);
  })();
} else if (Number(metaGet('catalog_version') || 0) < CATALOG_VERSION) {
  db.transaction(() => {
    const had = Number(metaGet('catalog_version') || 0);
    if (had < 2) {
      seedRows.filter(r => V1_IDS.includes(r[0])).forEach(runSeed);
      catalogV2Rows.forEach(runSeed);
      // Only touch these two when they're still exactly as the first release left them.
      db.prepare("UPDATE products SET name = ?, desc = ? WHERE id = 'f6' AND name = 'Whole Chicken'").run(BROILER_NAME, BROILER_DESC);
      db.prepare(`UPDATE products SET badges = '["Free-Range"]' WHERE id IN ('f28','r8','g14') AND (badges IS NULL OR badges = '[]')`).run();
    }
    if (had < 3) {
      const fresh = {};
      [...seedRows, ...catalogV2Rows].forEach(r => { fresh[r[0]] = r[5]; });
      const upd = db.prepare('UPDATE products SET desc = ? WHERE id = ? AND desc = ?');
      for (const id of Object.keys(OLD_DESCS)) if (fresh[id]) upd.run(fresh[id], id, OLD_DESCS[id]);
    }
    metaSet('catalog_version', CATALOG_VERSION);
  })();
}

// First-run branch seed. The four original branches are listed on the site; the
// middle-to-high-end Nairobi branches below are seeded UNLISTED (listed = 0) on purpose —
// the pins are approximate and nothing should appear on the live site until the branch
// really exists. Tick "Show on website" in admin.html > Branches to publish one, and use
// the same screen to fix its address, map pin and phone number. Only runs on an empty
// table, so it never overwrites edits made in admin.
const branchCount = db.prepare('SELECT COUNT(*) AS n FROM branches').get().n;
if (branchCount === 0) {
  // [id, name, area, address, query, lat, lng, phone, hours, is_main, listed, sort_order]
  const branchSeed = [
    ["syokimau", "Syokimau", "Syokimau", "Syokimau, Nairobi", "Azizo Butchery and Grill, Syokimau, Nairobi, Kenya", -1.381, 36.927, "", "Open 24 hours", 1, 1, 1],
    ["umoja", "Umoja", "Umoja", "Umoja, Nairobi", "Azizo Butchery and Grill, Umoja, Nairobi, Kenya", -1.2833, 36.8956, "", "Open 24 hours", 0, 1, 2],
    ["buruburu", "Buruburu", "Buruburu", "Buruburu, Nairobi", "Azizo Butchery and Grill, Buruburu, Nairobi, Kenya", -1.2864, 36.879, "", "Open 24 hours", 0, 1, 3],
    ["utawala", "Utawala", "Utawala", "Utawala, Nairobi", "Azizo Butchery and Grill, Utawala, Nairobi, Kenya", -1.287, 36.96, "", "Open 24 hours", 0, 1, 4],
    ["kilimani", "Kilimani", "Kilimani", "Kilimani, Nairobi", "Azizo Butchery and Grill, Kilimani, Nairobi, Kenya", -1.2921, 36.7878, "", "Open 24 hours", 0, 0, 5],
    ["lavington", "Lavington", "Lavington", "Lavington, Nairobi", "Azizo Butchery and Grill, Lavington, Nairobi, Kenya", -1.279, 36.77, "", "Open 24 hours", 0, 0, 6],
    ["westlands", "Westlands", "Westlands", "Westlands, Nairobi", "Azizo Butchery and Grill, Westlands, Nairobi, Kenya", -1.2635, 36.803, "", "Open 24 hours", 0, 0, 7],
    ["kileleshwa", "Kileleshwa", "Kileleshwa", "Kileleshwa, Nairobi", "Azizo Butchery and Grill, Kileleshwa, Nairobi, Kenya", -1.276, 36.784, "", "Open 24 hours", 0, 0, 8],
    ["parklands", "Parklands", "Parklands", "Parklands, Nairobi", "Azizo Butchery and Grill, Parklands, Nairobi, Kenya", -1.262, 36.818, "", "Open 24 hours", 0, 0, 9],
    ["karen", "Karen", "Karen", "Karen, Nairobi", "Azizo Butchery and Grill, Karen, Nairobi, Kenya", -1.319, 36.709, "", "Open 24 hours", 0, 0, 10],
    ["runda", "Runda", "Runda", "Runda, Nairobi", "Azizo Butchery and Grill, Runda, Nairobi, Kenya", -1.218, 36.807, "", "Open 24 hours", 0, 0, 11],
    ["muthaiga", "Muthaiga", "Muthaiga", "Muthaiga, Nairobi", "Azizo Butchery and Grill, Muthaiga, Nairobi, Kenya", -1.253, 36.836, "", "Open 24 hours", 0, 0, 12],
    ["gigiri", "Gigiri", "Gigiri", "Gigiri, Nairobi", "Azizo Butchery and Grill, Gigiri, Nairobi, Kenya", -1.231, 36.804, "", "Open 24 hours", 0, 0, 13],
    ["south-c", "South C", "South C", "South C, Nairobi", "Azizo Butchery and Grill, South C, Nairobi, Kenya", -1.315, 36.826, "", "Open 24 hours", 0, 0, 14],
  ];
  const insertBranch = db.prepare(`
    INSERT INTO branches (id, name, area, address, query, lat, lng, phone, hours, is_main, listed, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const seedBranches = db.transaction(() => { for (const row of branchSeed) insertBranch.run(...row); });
  seedBranches();
}

// ---- Delivery areas (v1.7) ----
// Every region of Nairobi is broken into zones (e.g. Umoja -> Umoja 1, Umoja 2 ...). Admin ticks which
// zones are currently served. Coordinates are approximate area centres - check them in Google Maps.
db.exec(`CREATE TABLE IF NOT EXISTS areas (
  id TEXT PRIMARY KEY, region TEXT NOT NULL, name TEXT NOT NULL, corridor TEXT DEFAULT '',
  lat REAL NOT NULL, lng REAL NOT NULL, active INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0
)`);
if (db.prepare('SELECT COUNT(*) AS n FROM areas').get().n === 0) {
  const seed = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'data', 'areas-seed.json'), 'utf8'));
  const ins = db.prepare('INSERT INTO areas (id, region, name, corridor, lat, lng, active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  db.transaction(() => { for (const a of seed.areas) ins.run(a.id, a.region, a.name, a.corridor || '', a.lat, a.lng, a.active ? 1 : 0, a.sort); })();
  if (!metaGet('delivery_config')) metaSet('delivery_config', JSON.stringify(seed.config));
}

// ---- v1.8: per-branch stock and verified customer reviews ----
// branch_stock_out lists only what is OUT at a branch (no row = available), so a new product or
// branch needs no setup. The global "sold out" switch (products.in_stock) still applies everywhere.
db.exec(`CREATE TABLE IF NOT EXISTS branch_stock_out (
  branch_id TEXT NOT NULL, product_id TEXT NOT NULL, PRIMARY KEY (branch_id, product_id)
)`);
// Reviews come only from real, completed orders (order number + phone), one per order, and stay
// 'pending' until admin approves them.
db.exec(`CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL UNIQUE, name TEXT, rating INTEGER NOT NULL,
  comment TEXT, photo TEXT, branch TEXT, status TEXT NOT NULL DEFAULT 'pending', reply TEXT,
  created_at TEXT DEFAULT (datetime('now'))
)`);

// ---- Cooking hub: recipes, blog posts, comments, reader submissions (v2.0) ----
db.exec(`CREATE TABLE IF NOT EXISTS recipe_cats (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, icon TEXT DEFAULT '', sort_order INTEGER DEFAULT 0)`);
db.exec(`CREATE TABLE IF NOT EXISTS recipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'recipe', slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
  category TEXT DEFAULT '', style TEXT DEFAULT '', cuisine TEXT DEFAULT '', difficulty TEXT DEFAULT '',
  prep_min INTEGER DEFAULT 0, cook_min INTEGER DEFAULT 0, servings INTEGER DEFAULT 0,
  summary TEXT DEFAULT '', ingredients TEXT DEFAULT '', steps TEXT DEFAULT '', tips TEXT DEFAULT '', body TEXT DEFAULT '',
  tags TEXT DEFAULT '', badge TEXT DEFAULT '', image TEXT DEFAULT '', featured INTEGER DEFAULT 0, status TEXT NOT NULL DEFAULT 'published',
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
)`);
db.exec(`CREATE TABLE IF NOT EXISTS recipe_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, recipe_id INTEGER NOT NULL, parent_id INTEGER DEFAULT 0, name TEXT, comment TEXT,
  rating INTEGER DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', is_staff INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
)`);
db.exec(`CREATE TABLE IF NOT EXISTS recipe_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT DEFAULT 'recipe', name TEXT, contact TEXT, title TEXT, message TEXT,
  status TEXT NOT NULL DEFAULT 'new', created_at TEXT DEFAULT (datetime('now'))
)`);
if (db.prepare('SELECT COUNT(*) AS n FROM recipes').get().n === 0) {
  const seed = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'data', 'recipes-seed.json'), 'utf8'));
  const ic = db.prepare('INSERT OR IGNORE INTO recipe_cats (name, icon, sort_order) VALUES (?, ?, ?)');
  const ir = db.prepare(`INSERT INTO recipes (kind, slug, title, category, style, cuisine, difficulty, prep_min, cook_min, servings, summary, ingredients, steps, tips, body, tags, badge, image, featured, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?)`);
  db.transaction(() => {
    for (const c of seed.categories) ic.run(c.name, c.icon || '', c.sort);
    for (const r of seed.recipes) ir.run(r.kind, r.slug, r.title, r.category, r.style, r.cuisine, r.difficulty, r.prep_min, r.cook_min, r.servings, r.summary,
      (r.ingredients || []).join('\n'), (r.steps || []).join('\n'), r.tips || '', r.body || '', r.tags || '', r.badge || '', r.image || '', r.featured ? 1 : 0, r.created_at, r.created_at);
  })();
}

// ---- Azizo Kitchens: partner kitchens marketplace (v3.0) ----
db.exec(`CREATE TABLE IF NOT EXISTS kk_dishes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, tradition TEXT DEFAULT '', category TEXT DEFAULT 'Combo', meal TEXT DEFAULT 'both',
  price INTEGER NOT NULL DEFAULT 0, serves INTEGER DEFAULT 1, description TEXT DEFAULT '', components TEXT DEFAULT '', method TEXT DEFAULT '', options TEXT DEFAULT '[]',
  packaging TEXT DEFAULT '', tips TEXT DEFAULT '', image TEXT DEFAULT '', active INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0
)`);
db.exec(`CREATE TABLE IF NOT EXISTS kk_kitchens (
  id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, cook_name TEXT, phone TEXT, email TEXT, password_hash TEXT,
  bio TEXT DEFAULT '', specialities TEXT DEFAULT '', experience TEXT DEFAULT '', address TEXT DEFAULT '', area_id TEXT DEFAULT '', region TEXT DEFAULT '',
  lat REAL, lng REAL, radius_km REAL DEFAULT 4, capacity INTEGER DEFAULT 10, prep_min INTEGER DEFAULT 45, status TEXT NOT NULL DEFAULT 'applied',
  commission_pct REAL, vetting TEXT DEFAULT '{}', notes TEXT DEFAULT '', strikes INTEGER DEFAULT 0, paused INTEGER DEFAULT 0, docs TEXT DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')), approved_at TEXT
)`);
db.exec(`CREATE TABLE IF NOT EXISTS kk_kitchen_dishes (kitchen_id INTEGER NOT NULL, dish_id INTEGER NOT NULL, available INTEGER DEFAULT 1, PRIMARY KEY (kitchen_id, dish_id))`);
db.exec(`CREATE TABLE IF NOT EXISTS kk_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kitchen_id INTEGER NOT NULL, name TEXT, phone TEXT, address TEXT, area_id TEXT DEFAULT '', lat REAL, lng REAL, distance_km REAL DEFAULT 0,
  date TEXT, meal TEXT, notes TEXT DEFAULT '', subtotal INTEGER DEFAULT 0, delivery_fee INTEGER DEFAULT 0, total INTEGER DEFAULT 0, payment TEXT DEFAULT 'cash',
  status TEXT NOT NULL DEFAULT 'new', commission_pct REAL DEFAULT 0, commission_amt INTEGER DEFAULT 0, kitchen_amt INTEGER DEFAULT 0, reason TEXT DEFAULT '',
  rating INTEGER DEFAULT 0, review TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')), ready_at TEXT
)`);
db.exec(`CREATE TABLE IF NOT EXISTS kk_order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, dish_id INTEGER, name TEXT, qty INTEGER, unit_price INTEGER, options_text TEXT DEFAULT '', line_total INTEGER)`);
db.exec(`CREATE TABLE IF NOT EXISTS kk_payouts (id INTEGER PRIMARY KEY AUTOINCREMENT, kitchen_id INTEGER NOT NULL, amount INTEGER NOT NULL, reference TEXT DEFAULT '', note TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')))`);
if (db.prepare('SELECT COUNT(*) AS n FROM kk_dishes').get().n === 0) {
  const seed = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'data', 'kitchens-seed.json'), 'utf8'));
  const ins = db.prepare('INSERT INTO kk_dishes (slug, name, tradition, category, meal, price, serves, description, components, method, options, packaging, tips, image, active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)');
  db.transaction(() => { for (const d of seed.dishes) ins.run(d.slug, d.name, d.tradition, d.category, d.meal, d.price, d.serves, d.description, d.components.join('\n'), d.method.join('\n'), JSON.stringify(d.options || []), d.packaging, d.tips || '', d.image || '', d.sort); })();
  if (!db.prepare("SELECT 1 FROM meta WHERE key = 'kk_settings'").get()) db.prepare("INSERT INTO meta (key, value) VALUES ('kk_settings', ?)").run(JSON.stringify(seed.settings));
}

// ---- Azizo Kitchens v3.1: riders, promos, corporate accounts, supply, audit, outbox, demand log ----
const kkAddCol = (t, c, def) => { if (!db.prepare(`PRAGMA table_info(${t})`).all().some(x => x.name === c)) { db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`); return true; } return false; };
for (const [c, d] of [['accepted_at', 'TEXT'], ['picked_at', 'TEXT'], ['delivered_at', 'TEXT'], ['rider_id', 'INTEGER'], ['delivery_code', "TEXT DEFAULT ''"], ['promo_code', "TEXT DEFAULT ''"], ['discount', 'INTEGER DEFAULT 0'],
  ['paid', 'INTEGER DEFAULT 0'], ['mpesa_checkout', "TEXT DEFAULT ''"], ['mpesa_receipt', "TEXT DEFAULT ''"], ['corp_id', 'INTEGER'], ['reassigned_from', 'INTEGER'], ['region', "TEXT DEFAULT ''"]]) kkAddCol('kk_orders', c, d);
if (kkAddCol('kk_dishes', 'tags', "TEXT DEFAULT ''")) {
  const veg = ['githeri', 'ndengu', 'sukuma', 'kachumbari', 'extra ugali', 'chapati (2', 'extra rice'], hot = ['biryani', 'pilau', 'kuku paka'], fish = ['tilapia', 'omena', 'fish'];
  for (const d of db.prepare('SELECT id, name FROM kk_dishes').all()) {
    const n = d.name.toLowerCase(), t = []; if (veg.some(x => n.includes(x))) t.push('vegetarian'); if (hot.some(x => n.includes(x))) t.push('spicy'); if (fish.some(x => n.includes(x))) t.push('fish');
    if (t.length) db.prepare('UPDATE kk_dishes SET tags = ? WHERE id = ?').run(t.join(','), d.id);
  }
}
db.exec(`CREATE TABLE IF NOT EXISTS kk_riders (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT NOT NULL, pin_hash TEXT NOT NULL, active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')))`);
db.exec(`CREATE TABLE IF NOT EXISTS kk_promos (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, kind TEXT NOT NULL DEFAULT 'pct', value INTEGER DEFAULT 0, min_order INTEGER DEFAULT 0, max_uses INTEGER DEFAULT 0, used INTEGER DEFAULT 0, expires TEXT DEFAULT '', active INTEGER DEFAULT 1, note TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')))`);
db.exec(`CREATE TABLE IF NOT EXISTS kk_corporate (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, code TEXT NOT NULL UNIQUE, contact TEXT DEFAULT '', phone TEXT DEFAULT '', email TEXT DEFAULT '', address TEXT DEFAULT '', area_id TEXT DEFAULT '', discount_pct REAL DEFAULT 0, active INTEGER DEFAULT 1, notes TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')))`);
db.exec(`CREATE TABLE IF NOT EXISTS kk_supply (id INTEGER PRIMARY KEY AUTOINCREMENT, kitchen_id INTEGER NOT NULL, items TEXT DEFAULT '[]', note TEXT DEFAULT '', total INTEGER DEFAULT 0, status TEXT DEFAULT 'requested', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`);
db.exec(`CREATE TABLE IF NOT EXISTS kk_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT DEFAULT (datetime('now')), actor TEXT DEFAULT '', action TEXT DEFAULT '', target TEXT DEFAULT '', detail TEXT DEFAULT '')`);
db.exec(`CREATE TABLE IF NOT EXISTS kk_outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT, kind TEXT DEFAULT '', message TEXT, order_id INTEGER, status TEXT DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now')), sent_at TEXT)`);
db.exec(`CREATE TABLE IF NOT EXISTS kk_demand (date TEXT NOT NULL, area_id TEXT NOT NULL, region TEXT DEFAULT '', name TEXT DEFAULT '', n INTEGER DEFAULT 0, PRIMARY KEY (date, area_id))`);
db.exec('CREATE INDEX IF NOT EXISTS idx_kk_orders_k ON kk_orders (kitchen_id, date, meal)');
db.exec('CREATE INDEX IF NOT EXISTS idx_kk_orders_phone ON kk_orders (phone)');

db.metaGet = metaGet; db.metaSet = metaSet;
module.exports = db;

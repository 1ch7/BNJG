-- =============================================================
-- BNJGFoodSolutions — Demo Seed
-- Restaurant : Trattoria Verde
-- Manager    : Marco Rossi  (marco.rossi@trattoriaverde.it)
-- 3 weeks    : 2 Jun – 22 Jun 2026
-- Overstock  : Fresh Basil (6× weekly use), San Marzano Tomatoes (2× weekly use)
-- =============================================================
--
-- USAGE:
--   1. Create the manager's Supabase Auth account via the app (Login > Register).
--   2. Replace the manager_uuid value below with the uid from auth.users.
--   3. Run this file in the Supabase SQL editor or via `supabase db reset`.
--
-- =============================================================

DO $$
DECLARE
  -- Replace with the real auth.uid() after the manager signs up
  manager_uuid uuid := 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

  -- menus
  mid_margherita uuid := gen_random_uuid();
  mid_pomodoro   uuid := gen_random_uuid();
  mid_carbonara  uuid := gen_random_uuid();
  mid_bruschetta uuid := gen_random_uuid();
  mid_tiramisu   uuid := gen_random_uuid();
  mid_limonata   uuid := gen_random_uuid();

  -- ingredients
  iid_pizza_dough   uuid := gen_random_uuid();
  iid_san_marzano   uuid := gen_random_uuid();
  iid_mozzarella    uuid := gen_random_uuid();
  iid_fresh_basil   uuid := gen_random_uuid();
  iid_olive_oil     uuid := gen_random_uuid();
  iid_salt          uuid := gen_random_uuid();
  iid_rigatoni      uuid := gen_random_uuid();
  iid_garlic        uuid := gen_random_uuid();
  iid_parmesan      uuid := gen_random_uuid();
  iid_spaghetti     uuid := gen_random_uuid();
  iid_pancetta      uuid := gen_random_uuid();
  iid_eggs          uuid := gen_random_uuid();
  iid_pecorino      uuid := gen_random_uuid();
  iid_black_pepper  uuid := gen_random_uuid();
  iid_sourdough     uuid := gen_random_uuid();
  iid_mascarpone    uuid := gen_random_uuid();
  iid_savoiardi     uuid := gen_random_uuid();
  iid_espresso      uuid := gen_random_uuid();
  iid_cocoa         uuid := gen_random_uuid();
  iid_sugar         uuid := gen_random_uuid();
  iid_lemon_juice   uuid := gen_random_uuid();
  iid_sucrose_syrup uuid := gen_random_uuid();
  iid_sparkling     uuid := gen_random_uuid();
  iid_lemon_slice   uuid := gen_random_uuid();
  iid_ice_cubes     uuid := gen_random_uuid();

BEGIN

-- -------------------------------------------------------
-- 1. MANAGER
-- -------------------------------------------------------
INSERT INTO managers (id, restaurant_name, email) VALUES
  (manager_uuid, 'Trattoria Verde', 'marco.rossi@trattoriaverde.it');


-- -------------------------------------------------------
-- 2. MENUS  (6 items: 3 Main, 1 Starter, 1 Dessert, 1 Beverage)
-- -------------------------------------------------------
INSERT INTO menus (id, manager_id, name, category, price) VALUES
  (mid_margherita, manager_uuid, 'Margherita Pizza',       'Main Course',    14.00),
  (mid_pomodoro,   manager_uuid, 'Pasta Pomodoro',          'Main Course',    12.00),
  (mid_carbonara,  manager_uuid, 'Spaghetti Carbonara',     'Main Course',    13.50),
  (mid_bruschetta, manager_uuid, 'Bruschetta al Pomodoro',  'Starter',         7.00),
  (mid_tiramisu,   manager_uuid, 'Tiramisu',                'Dessert',         8.50),
  (mid_limonata,   manager_uuid, 'Limonata Fresca',         'Beverages',       4.50);


-- -------------------------------------------------------
-- 3. INGREDIENTS
--    current_stock is back-calculated from 3 weeks of sales.
--    Fresh Basil:       3000g stock, 1004g consumed → 1996g remaining (6× weekly use)
--    San Marzano:      29000g stock, 17240g consumed → 11760g remaining (2× weekly use)
-- -------------------------------------------------------
INSERT INTO ingredients
  (id, manager_id, name, unit, initial_stock, current_stock, reorder_level)
VALUES
  -- Margherita Pizza ingredients
  (iid_pizza_dough,  manager_uuid, 'Pizza Dough',              'g',    22000,  2680,  2000),
  (iid_san_marzano,  manager_uuid, 'San Marzano Tomatoes',     'g',    29000, 11760,  3000),  -- OVERSTOCK 2.0×
  (iid_mozzarella,   manager_uuid, 'Mozzarella Fior di Latte', 'g',     8000,  1100,  1000),
  (iid_fresh_basil,  manager_uuid, 'Fresh Basil',              'g',     3000,  1996,   200),  -- OVERSTOCK 6.0×
  (iid_olive_oil,    manager_uuid, 'Olive Oil',                'ml',    3000,   805,   500),
  (iid_salt,         manager_uuid, 'Salt',                     'g',     1000,   174,   200),
  -- Pasta Pomodoro extra ingredients
  (iid_rigatoni,     manager_uuid, 'Rigatoni',                 'g',     7000,  1880,  1500),
  (iid_garlic,       manager_uuid, 'Garlic',                   'g',      500,   184,   100),
  (iid_parmesan,     manager_uuid, 'Parmesan',                 'g',      600,   120,   150),
  -- Spaghetti Carbonara extra ingredients
  (iid_spaghetti,    manager_uuid, 'Spaghetti',                'g',    32000,  3200,  3000),
  (iid_pancetta,     manager_uuid, 'Pancetta',                 'g',    12000,  1200,  1000),
  (iid_eggs,         manager_uuid, 'Eggs',                     'pcs',    700,    72,    60),
  (iid_pecorino,     manager_uuid, 'Pecorino Romano',          'g',     6000,   600,   500),
  (iid_black_pepper, manager_uuid, 'Black Pepper',             'g',      500,   140,    80),
  -- Bruschetta extra ingredients
  (iid_sourdough,    manager_uuid, 'Sourdough Bread',          'g',     5000,   840,   800),
  -- Tiramisu extra ingredients
  (iid_mascarpone,   manager_uuid, 'Mascarpone',               'g',    15000,  1600,  1000),
  (iid_savoiardi,    manager_uuid, 'Savoiardi Biscuits',       'g',     9000,   960,   600),
  (iid_espresso,     manager_uuid, 'Espresso',                 'ml',   12000,  1280,  1000),
  (iid_cocoa,        manager_uuid, 'Cocoa Powder',             'g',      800,   130,    80),
  (iid_sugar,        manager_uuid, 'Sugar',                    'g',     3000,   320,   300),
  -- Limonata Fresca extra ingredients
  (iid_lemon_juice,  manager_uuid, 'Lemon Juice',              'ml',   16000,   820,  1000),
  (iid_sucrose_syrup,manager_uuid, 'Sucrose Syrup',            'ml',    7000,   675,   500),
  (iid_sparkling,    manager_uuid, 'Sparkling Water',          'ml',   80000,  4100,  8000),
  (iid_lemon_slice,  manager_uuid, 'Lemon Slice',              'pcs',    280,    27,    30),
  (iid_ice_cubes,    manager_uuid, 'Ice Cubes',                'g',    40000,  2050,  5000);


-- -------------------------------------------------------
-- 4. RECIPES  (qty per 1 serving)
-- -------------------------------------------------------

-- Margherita Pizza
INSERT INTO recipes (menu_id, ingredient_id, quantity_used) VALUES
  (mid_margherita, iid_pizza_dough,  280),
  (mid_margherita, iid_san_marzano,  120),
  (mid_margherita, iid_mozzarella,   100),
  (mid_margherita, iid_fresh_basil,    8),
  (mid_margherita, iid_olive_oil,     15),
  (mid_margherita, iid_salt,           2);

-- Pasta Pomodoro
INSERT INTO recipes (menu_id, ingredient_id, quantity_used) VALUES
  (mid_pomodoro, iid_rigatoni,      160),
  (mid_pomodoro, iid_san_marzano,   150),
  (mid_pomodoro, iid_fresh_basil,     6),
  (mid_pomodoro, iid_olive_oil,      20),
  (mid_pomodoro, iid_garlic,          5),
  (mid_pomodoro, iid_parmesan,       15),
  (mid_pomodoro, iid_salt,            3);

-- Spaghetti Carbonara
INSERT INTO recipes (menu_id, ingredient_id, quantity_used) VALUES
  (mid_carbonara, iid_spaghetti,     160),
  (mid_carbonara, iid_pancetta,       60),
  (mid_carbonara, iid_eggs,            2),
  (mid_carbonara, iid_pecorino,       30),
  (mid_carbonara, iid_black_pepper,    2),
  (mid_carbonara, iid_salt,            3);

-- Bruschetta al Pomodoro
INSERT INTO recipes (menu_id, ingredient_id, quantity_used) VALUES
  (mid_bruschetta, iid_sourdough,    80),
  (mid_bruschetta, iid_san_marzano,  80),
  (mid_bruschetta, iid_fresh_basil,   5),
  (mid_bruschetta, iid_olive_oil,    10),
  (mid_bruschetta, iid_garlic,        3),
  (mid_bruschetta, iid_salt,          1);

-- Tiramisu
INSERT INTO recipes (menu_id, ingredient_id, quantity_used) VALUES
  (mid_tiramisu, iid_mascarpone,   100),
  (mid_tiramisu, iid_eggs,           2),
  (mid_tiramisu, iid_savoiardi,     60),
  (mid_tiramisu, iid_espresso,      80),
  (mid_tiramisu, iid_cocoa,          5),
  (mid_tiramisu, iid_sugar,         20);

-- Limonata Fresca
INSERT INTO recipes (menu_id, ingredient_id, quantity_used) VALUES
  (mid_limonata, iid_lemon_juice,   60),
  (mid_limonata, iid_sucrose_syrup, 25),
  (mid_limonata, iid_sparkling,    300),
  (mid_limonata, iid_lemon_slice,    1),
  (mid_limonata, iid_ice_cubes,    150);


-- -------------------------------------------------------
-- 5. DAILY SALES — 3 weeks (2 Jun – 22 Jun 2026)
--    LOW: Margherita (2-4/day), Pasta Pomodoro (1-2/day), Bruschetta (2-3/day)
--         → deplete Fresh Basil and San Marzano slowly → triggers overstock alerts
--    NORMAL: Carbonara (7-10/day), Tiramisu (5-8/day), Limonata (10-14/day)
-- -------------------------------------------------------

-- WEEK 1: 2–8 Jun 2026
INSERT INTO daily_sales (manager_id, menu_id, quantity_sold, sale_date) VALUES
  -- Mon 2 Jun
  (manager_uuid, mid_margherita,  3, '2026-06-02'),
  (manager_uuid, mid_pomodoro,    2, '2026-06-02'),
  (manager_uuid, mid_carbonara,   7, '2026-06-02'),
  (manager_uuid, mid_bruschetta,  2, '2026-06-02'),
  (manager_uuid, mid_tiramisu,    5, '2026-06-02'),
  (manager_uuid, mid_limonata,   10, '2026-06-02'),
  -- Tue 3 Jun
  (manager_uuid, mid_margherita,  2, '2026-06-03'),
  (manager_uuid, mid_pomodoro,    1, '2026-06-03'),
  (manager_uuid, mid_carbonara,   7, '2026-06-03'),
  (manager_uuid, mid_bruschetta,  3, '2026-06-03'),
  (manager_uuid, mid_tiramisu,    5, '2026-06-03'),
  (manager_uuid, mid_limonata,   10, '2026-06-03'),
  -- Wed 4 Jun
  (manager_uuid, mid_margherita,  4, '2026-06-04'),
  (manager_uuid, mid_pomodoro,    2, '2026-06-04'),
  (manager_uuid, mid_carbonara,   8, '2026-06-04'),
  (manager_uuid, mid_bruschetta,  2, '2026-06-04'),
  (manager_uuid, mid_tiramisu,    6, '2026-06-04'),
  (manager_uuid, mid_limonata,   12, '2026-06-04'),
  -- Thu 5 Jun
  (manager_uuid, mid_margherita,  3, '2026-06-05'),
  (manager_uuid, mid_pomodoro,    1, '2026-06-05'),
  (manager_uuid, mid_carbonara,   9, '2026-06-05'),
  (manager_uuid, mid_bruschetta,  3, '2026-06-05'),
  (manager_uuid, mid_tiramisu,    6, '2026-06-05'),
  (manager_uuid, mid_limonata,   12, '2026-06-05'),
  -- Fri 6 Jun
  (manager_uuid, mid_margherita,  4, '2026-06-06'),
  (manager_uuid, mid_pomodoro,    2, '2026-06-06'),
  (manager_uuid, mid_carbonara,  10, '2026-06-06'),
  (manager_uuid, mid_bruschetta,  3, '2026-06-06'),
  (manager_uuid, mid_tiramisu,    7, '2026-06-06'),
  (manager_uuid, mid_limonata,   14, '2026-06-06'),
  -- Sat 7 Jun
  (manager_uuid, mid_margherita,  4, '2026-06-07'),
  (manager_uuid, mid_pomodoro,    2, '2026-06-07'),
  (manager_uuid, mid_carbonara,  10, '2026-06-07'),
  (manager_uuid, mid_bruschetta,  3, '2026-06-07'),
  (manager_uuid, mid_tiramisu,    8, '2026-06-07'),
  (manager_uuid, mid_limonata,   14, '2026-06-07'),
  -- Sun 8 Jun
  (manager_uuid, mid_margherita,  3, '2026-06-08'),
  (manager_uuid, mid_pomodoro,    1, '2026-06-08'),
  (manager_uuid, mid_carbonara,   9, '2026-06-08'),
  (manager_uuid, mid_bruschetta,  2, '2026-06-08'),
  (manager_uuid, mid_tiramisu,    7, '2026-06-08'),
  (manager_uuid, mid_limonata,   12, '2026-06-08');

-- WEEK 2: 9–15 Jun 2026
INSERT INTO daily_sales (manager_id, menu_id, quantity_sold, sale_date) VALUES
  -- Mon 9 Jun
  (manager_uuid, mid_margherita,  2, '2026-06-09'),
  (manager_uuid, mid_pomodoro,    1, '2026-06-09'),
  (manager_uuid, mid_carbonara,   7, '2026-06-09'),
  (manager_uuid, mid_bruschetta,  2, '2026-06-09'),
  (manager_uuid, mid_tiramisu,    5, '2026-06-09'),
  (manager_uuid, mid_limonata,   10, '2026-06-09'),
  -- Tue 10 Jun
  (manager_uuid, mid_margherita,  3, '2026-06-10'),
  (manager_uuid, mid_pomodoro,    2, '2026-06-10'),
  (manager_uuid, mid_carbonara,   8, '2026-06-10'),
  (manager_uuid, mid_bruschetta,  2, '2026-06-10'),
  (manager_uuid, mid_tiramisu,    6, '2026-06-10'),
  (manager_uuid, mid_limonata,   11, '2026-06-10'),
  -- Wed 11 Jun
  (manager_uuid, mid_margherita,  4, '2026-06-11'),
  (manager_uuid, mid_pomodoro,    2, '2026-06-11'),
  (manager_uuid, mid_carbonara,   8, '2026-06-11'),
  (manager_uuid, mid_bruschetta,  3, '2026-06-11'),
  (manager_uuid, mid_tiramisu,    6, '2026-06-11'),
  (manager_uuid, mid_limonata,   12, '2026-06-11'),
  -- Thu 12 Jun
  (manager_uuid, mid_margherita,  3, '2026-06-12'),
  (manager_uuid, mid_pomodoro,    1, '2026-06-12'),
  (manager_uuid, mid_carbonara,   9, '2026-06-12'),
  (manager_uuid, mid_bruschetta,  2, '2026-06-12'),
  (manager_uuid, mid_tiramisu,    7, '2026-06-12'),
  (manager_uuid, mid_limonata,   12, '2026-06-12'),
  -- Fri 13 Jun
  (manager_uuid, mid_margherita,  4, '2026-06-13'),
  (manager_uuid, mid_pomodoro,    2, '2026-06-13'),
  (manager_uuid, mid_carbonara,  10, '2026-06-13'),
  (manager_uuid, mid_bruschetta,  3, '2026-06-13'),
  (manager_uuid, mid_tiramisu,    7, '2026-06-13'),
  (manager_uuid, mid_limonata,   14, '2026-06-13'),
  -- Sat 14 Jun
  (manager_uuid, mid_margherita,  4, '2026-06-14'),
  (manager_uuid, mid_pomodoro,    2, '2026-06-14'),
  (manager_uuid, mid_carbonara,  10, '2026-06-14'),
  (manager_uuid, mid_bruschetta,  3, '2026-06-14'),
  (manager_uuid, mid_tiramisu,    8, '2026-06-14'),
  (manager_uuid, mid_limonata,   14, '2026-06-14'),
  -- Sun 15 Jun
  (manager_uuid, mid_margherita,  3, '2026-06-15'),
  (manager_uuid, mid_pomodoro,    1, '2026-06-15'),
  (manager_uuid, mid_carbonara,   9, '2026-06-15'),
  (manager_uuid, mid_bruschetta,  2, '2026-06-15'),
  (manager_uuid, mid_tiramisu,    7, '2026-06-15'),
  (manager_uuid, mid_limonata,   12, '2026-06-15');

-- WEEK 3: 16–22 Jun 2026
INSERT INTO daily_sales (manager_id, menu_id, quantity_sold, sale_date) VALUES
  -- Mon 16 Jun
  (manager_uuid, mid_margherita,  2, '2026-06-16'),
  (manager_uuid, mid_pomodoro,    1, '2026-06-16'),
  (manager_uuid, mid_carbonara,   7, '2026-06-16'),
  (manager_uuid, mid_bruschetta,  2, '2026-06-16'),
  (manager_uuid, mid_tiramisu,    5, '2026-06-16'),
  (manager_uuid, mid_limonata,   10, '2026-06-16'),
  -- Tue 17 Jun
  (manager_uuid, mid_margherita,  3, '2026-06-17'),
  (manager_uuid, mid_pomodoro,    1, '2026-06-17'),
  (manager_uuid, mid_carbonara,   7, '2026-06-17'),
  (manager_uuid, mid_bruschetta,  2, '2026-06-17'),
  (manager_uuid, mid_tiramisu,    5, '2026-06-17'),
  (manager_uuid, mid_limonata,   11, '2026-06-17'),
  -- Wed 18 Jun
  (manager_uuid, mid_margherita,  4, '2026-06-18'),
  (manager_uuid, mid_pomodoro,    2, '2026-06-18'),
  (manager_uuid, mid_carbonara,   9, '2026-06-18'),
  (manager_uuid, mid_bruschetta,  3, '2026-06-18'),
  (manager_uuid, mid_tiramisu,    6, '2026-06-18'),
  (manager_uuid, mid_limonata,   12, '2026-06-18'),
  -- Thu 19 Jun
  (manager_uuid, mid_margherita,  3, '2026-06-19'),
  (manager_uuid, mid_pomodoro,    1, '2026-06-19'),
  (manager_uuid, mid_carbonara,   8, '2026-06-19'),
  (manager_uuid, mid_bruschetta,  2, '2026-06-19'),
  (manager_uuid, mid_tiramisu,    6, '2026-06-19'),
  (manager_uuid, mid_limonata,   12, '2026-06-19'),
  -- Fri 20 Jun
  (manager_uuid, mid_margherita,  4, '2026-06-20'),
  (manager_uuid, mid_pomodoro,    2, '2026-06-20'),
  (manager_uuid, mid_carbonara,   9, '2026-06-20'),
  (manager_uuid, mid_bruschetta,  3, '2026-06-20'),
  (manager_uuid, mid_tiramisu,    7, '2026-06-20'),
  (manager_uuid, mid_limonata,   13, '2026-06-20'),
  -- Sat 21 Jun
  (manager_uuid, mid_margherita,  4, '2026-06-21'),
  (manager_uuid, mid_pomodoro,    2, '2026-06-21'),
  (manager_uuid, mid_carbonara,  10, '2026-06-21'),
  (manager_uuid, mid_bruschetta,  3, '2026-06-21'),
  (manager_uuid, mid_tiramisu,    8, '2026-06-21'),
  (manager_uuid, mid_limonata,   14, '2026-06-21'),
  -- Sun 22 Jun
  (manager_uuid, mid_margherita,  3, '2026-06-22'),
  (manager_uuid, mid_pomodoro,    1, '2026-06-22'),
  (manager_uuid, mid_carbonara,   9, '2026-06-22'),
  (manager_uuid, mid_bruschetta,  2, '2026-06-22'),
  (manager_uuid, mid_tiramisu,    7, '2026-06-22'),
  (manager_uuid, mid_limonata,   12, '2026-06-22');


-- -------------------------------------------------------
-- 6. WEATHER LOG — 7 days (14–20 Jun 2026)
--    Rainy Wed–Thu show lower covers; sunny Sat highest.
-- -------------------------------------------------------
INSERT INTO weather_log (manager_id, log_date, temperature_c, weather_desc, customer_count)
VALUES
  (manager_uuid, '2026-06-14', 28, 'sunny',         74),
  (manager_uuid, '2026-06-15', 26, 'partly cloudy', 66),
  (manager_uuid, '2026-06-16', 22, 'overcast',      51),
  (manager_uuid, '2026-06-17', 19, 'rainy',         37),
  (manager_uuid, '2026-06-18', 21, 'rainy',         40),
  (manager_uuid, '2026-06-19', 24, 'partly cloudy', 58),
  (manager_uuid, '2026-06-20', 27, 'sunny',         70);

END $$;

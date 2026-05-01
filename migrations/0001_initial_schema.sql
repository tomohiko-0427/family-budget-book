-- 家計簿アプリの初期スキーマ

-- カテゴリーテーブル
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
  icon TEXT DEFAULT '💰',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 取引テーブル
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
  amount INTEGER NOT NULL,
  category_id INTEGER NOT NULL,
  description TEXT,
  date TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES categories(id)
);

-- インデックス作成
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);

-- デフォルトカテゴリーの挿入
INSERT OR IGNORE INTO categories (name, type, icon) VALUES 
  ('給料', 'income', '💼'),
  ('副業', 'income', '💻'),
  ('その他収入', 'income', '💰'),
  ('食費', 'expense', '🍽️'),
  ('日用品', 'expense', '🧴'),
  ('衣料品', 'expense', '👕'),
  ('交通費', 'expense', '🚃'),
  ('娯楽', 'expense', '🎮'),
  ('光熱費', 'expense', '💡'),
  ('家賃', 'expense', '🏠'),
  ('通信費', 'expense', '📱'),
  ('医療費', 'expense', '🏥'),
  ('その他支出', 'expense', '📦');

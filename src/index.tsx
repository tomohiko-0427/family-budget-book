import { Hono } from 'hono'
import { cors } from 'hono/cors'

type Bindings = {
  DB: D1Database;
}

const app = new Hono<{ Bindings: Bindings }>()

// CORS設定（API用）
app.use('/api/*', cors())

// === API Routes ===

// カテゴリー一覧取得
app.get('/api/categories', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(`
      SELECT * FROM categories ORDER BY type, name
    `).all()
    
    return c.json({ categories: results })
  } catch (error) {
    console.error(error)
    return c.json({ error: 'Failed to fetch categories' }, 500)
  }
})

// 取引一覧取得（月別フィルタ対応）
app.get('/api/transactions', async (c) => {
  try {
    const month = c.req.query('month') // YYYY-MM形式
    
    let query = `
      SELECT 
        t.id,
        t.type,
        t.amount,
        t.description,
        t.date,
        t.created_at,
        c.name as category_name,
        c.icon as category_icon
      FROM transactions t
      JOIN categories c ON t.category_id = c.id
    `
    
    if (month) {
      query += ` WHERE t.date LIKE '${month}%'`
    }
    
    query += ` ORDER BY t.date DESC, t.created_at DESC`
    
    const { results } = await c.env.DB.prepare(query).all()
    
    return c.json({ transactions: results })
  } catch (error) {
    console.error(error)
    return c.json({ error: 'Failed to fetch transactions' }, 500)
  }
})

// 取引作成
app.post('/api/transactions', async (c) => {
  try {
    const { type, amount, category_id, description, date } = await c.req.json()
    
    // バリデーション
    if (!type || !amount || !category_id || !date) {
      return c.json({ error: 'Missing required fields' }, 400)
    }
    
    if (!['income', 'expense'].includes(type)) {
      return c.json({ error: 'Invalid type' }, 400)
    }
    
    const result = await c.env.DB.prepare(`
      INSERT INTO transactions (type, amount, category_id, description, date)
      VALUES (?, ?, ?, ?, ?)
    `).bind(type, amount, category_id, description || '', date).run()
    
    return c.json({ 
      id: result.meta.last_row_id,
      type,
      amount,
      category_id,
      description,
      date
    }, 201)
  } catch (error) {
    console.error(error)
    return c.json({ error: 'Failed to create transaction' }, 500)
  }
})

// 取引削除
app.delete('/api/transactions/:id', async (c) => {
  try {
    const id = c.req.param('id')
    
    await c.env.DB.prepare(`
      DELETE FROM transactions WHERE id = ?
    `).bind(id).run()
    
    return c.json({ success: true })
  } catch (error) {
    console.error(error)
    return c.json({ error: 'Failed to delete transaction' }, 500)
  }
})

// サマリー取得（月別）
app.get('/api/summary', async (c) => {
  try {
    const month = c.req.query('month') // YYYY-MM形式
    
    let query = `
      SELECT 
        type,
        SUM(amount) as total
      FROM transactions
    `
    
    if (month) {
      query += ` WHERE date LIKE '${month}%'`
    }
    
    query += ` GROUP BY type`
    
    const { results } = await c.env.DB.prepare(query).all()
    
    const summary = {
      income: 0,
      expense: 0,
      balance: 0
    }
    
    results.forEach((row: any) => {
      if (row.type === 'income') {
        summary.income = row.total
      } else if (row.type === 'expense') {
        summary.expense = row.total
      }
    })
    
    summary.balance = summary.income - summary.expense
    
    return c.json(summary)
  } catch (error) {
    console.error(error)
    return c.json({ error: 'Failed to fetch summary' }, 500)
  }
})

// === Frontend ===

app.get('/', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>家計簿アプリ</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
        <style>
          .transaction-income {
            border-left: 4px solid #10b981;
          }
          .transaction-expense {
            border-left: 4px solid #ef4444;
          }
        </style>
    </head>
    <body class="bg-gray-50">
        <div class="max-w-4xl mx-auto p-4 md:p-8">
            <!-- ヘッダー -->
            <div class="bg-white rounded-lg shadow-md p-6 mb-6">
                <h1 class="text-3xl font-bold text-gray-800 mb-2">
                    <i class="fas fa-wallet mr-2 text-blue-600"></i>
                    家計簿アプリ
                </h1>
                <p class="text-gray-600">収支を記録して、お金の流れを把握しましょう</p>
            </div>

            <!-- サマリー -->
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div class="bg-white rounded-lg shadow-md p-6">
                    <div class="flex items-center justify-between">
                        <div>
                            <p class="text-gray-600 text-sm mb-1">収入</p>
                            <p class="text-2xl font-bold text-green-600" id="total-income">¥0</p>
                        </div>
                        <i class="fas fa-arrow-up text-green-600 text-3xl"></i>
                    </div>
                </div>
                <div class="bg-white rounded-lg shadow-md p-6">
                    <div class="flex items-center justify-between">
                        <div>
                            <p class="text-gray-600 text-sm mb-1">支出</p>
                            <p class="text-2xl font-bold text-red-600" id="total-expense">¥0</p>
                        </div>
                        <i class="fas fa-arrow-down text-red-600 text-3xl"></i>
                    </div>
                </div>
                <div class="bg-white rounded-lg shadow-md p-6">
                    <div class="flex items-center justify-between">
                        <div>
                            <p class="text-gray-600 text-sm mb-1">残高</p>
                            <p class="text-2xl font-bold text-blue-600" id="balance">¥0</p>
                        </div>
                        <i class="fas fa-calculator text-blue-600 text-3xl"></i>
                    </div>
                </div>
            </div>

            <!-- 月選択 -->
            <div class="bg-white rounded-lg shadow-md p-6 mb-6">
                <label class="block text-gray-700 font-semibold mb-2">
                    <i class="fas fa-calendar mr-2"></i>表示月
                </label>
                <input type="month" id="month-selector" class="w-full md:w-auto px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent">
            </div>

            <!-- 入力フォーム -->
            <div class="bg-white rounded-lg shadow-md p-6 mb-6">
                <h2 class="text-xl font-bold text-gray-800 mb-4">
                    <i class="fas fa-plus-circle mr-2 text-blue-600"></i>
                    新しい取引を追加
                </h2>
                <form id="transaction-form">
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <div>
                            <label class="block text-gray-700 font-semibold mb-2">種類</label>
                            <select id="type" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" required>
                                <option value="expense">支出</option>
                                <option value="income">収入</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-gray-700 font-semibold mb-2">金額</label>
                            <input type="number" id="amount" min="0" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" placeholder="1000" required>
                        </div>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <div>
                            <label class="block text-gray-700 font-semibold mb-2">カテゴリー</label>
                            <select id="category" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" required>
                                <option value="">選択してください</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-gray-700 font-semibold mb-2">日付</label>
                            <input type="date" id="date" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" required>
                        </div>
                    </div>
                    <div class="mb-4">
                        <label class="block text-gray-700 font-semibold mb-2">メモ</label>
                        <input type="text" id="description" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" placeholder="詳細を入力（任意）">
                    </div>
                    <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg transition duration-200">
                        <i class="fas fa-save mr-2"></i>
                        保存
                    </button>
                </form>
            </div>

            <!-- 取引履歴 -->
            <div class="bg-white rounded-lg shadow-md p-6">
                <h2 class="text-xl font-bold text-gray-800 mb-4">
                    <i class="fas fa-history mr-2 text-blue-600"></i>
                    取引履歴
                </h2>
                <div id="transactions-list" class="space-y-3">
                    <p class="text-gray-500 text-center py-8">取引履歴がありません</p>
                </div>
            </div>
        </div>

        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        <script>
          // グローバル変数
          let categories = [];
          let currentMonth = '';

          // 初期化
          document.addEventListener('DOMContentLoaded', async () => {
            // 今月を設定
            const now = new Date();
            currentMonth = now.toISOString().slice(0, 7);
            document.getElementById('month-selector').value = currentMonth;
            document.getElementById('date').valueAsDate = now;

            // データ読み込み
            await loadCategories();
            await loadTransactions();
            await loadSummary();

            // イベントリスナー設定
            document.getElementById('transaction-form').addEventListener('submit', handleSubmit);
            document.getElementById('type').addEventListener('change', updateCategoryOptions);
            document.getElementById('month-selector').addEventListener('change', handleMonthChange);
          });

          // カテゴリー読み込み
          async function loadCategories() {
            try {
              const response = await axios.get('/api/categories');
              categories = response.data.categories;
              updateCategoryOptions();
            } catch (error) {
              console.error('Failed to load categories:', error);
              alert('カテゴリーの読み込みに失敗しました');
            }
          }

          // カテゴリー選択肢更新
          function updateCategoryOptions() {
            const type = document.getElementById('type').value;
            const categorySelect = document.getElementById('category');
            
            const filtered = categories.filter(c => c.type === type);
            
            categorySelect.innerHTML = '<option value="">選択してください</option>';
            filtered.forEach(cat => {
              const option = document.createElement('option');
              option.value = cat.id;
              option.textContent = \`\${cat.icon} \${cat.name}\`;
              categorySelect.appendChild(option);
            });
          }

          // 取引履歴読み込み
          async function loadTransactions() {
            try {
              const response = await axios.get(\`/api/transactions?month=\${currentMonth}\`);
              const transactions = response.data.transactions;
              
              const listEl = document.getElementById('transactions-list');
              
              if (transactions.length === 0) {
                listEl.innerHTML = '<p class="text-gray-500 text-center py-8">取引履歴がありません</p>';
                return;
              }
              
              listEl.innerHTML = transactions.map(t => \`
                <div class="transaction-\${t.type} bg-gray-50 rounded-lg p-4 flex items-center justify-between hover:bg-gray-100 transition">
                  <div class="flex items-center space-x-4">
                    <div class="text-3xl">\${t.category_icon}</div>
                    <div>
                      <p class="font-semibold text-gray-800">\${t.category_name}</p>
                      <p class="text-sm text-gray-600">\${t.description || '-'}</p>
                      <p class="text-xs text-gray-500">\${t.date}</p>
                    </div>
                  </div>
                  <div class="flex items-center space-x-3">
                    <p class="text-xl font-bold \${t.type === 'income' ? 'text-green-600' : 'text-red-600'}">
                      \${t.type === 'income' ? '+' : '-'}¥\${t.amount.toLocaleString()}
                    </p>
                    <button onclick="deleteTransaction(\${t.id})" class="text-red-500 hover:text-red-700 transition">
                      <i class="fas fa-trash"></i>
                    </button>
                  </div>
                </div>
              \`).join('');
            } catch (error) {
              console.error('Failed to load transactions:', error);
              alert('取引履歴の読み込みに失敗しました');
            }
          }

          // サマリー読み込み
          async function loadSummary() {
            try {
              const response = await axios.get(\`/api/summary?month=\${currentMonth}\`);
              const { income, expense, balance } = response.data;
              
              document.getElementById('total-income').textContent = \`¥\${income.toLocaleString()}\`;
              document.getElementById('total-expense').textContent = \`¥\${expense.toLocaleString()}\`;
              document.getElementById('balance').textContent = \`¥\${balance.toLocaleString()}\`;
            } catch (error) {
              console.error('Failed to load summary:', error);
            }
          }

          // フォーム送信
          async function handleSubmit(e) {
            e.preventDefault();
            
            const data = {
              type: document.getElementById('type').value,
              amount: parseInt(document.getElementById('amount').value),
              category_id: parseInt(document.getElementById('category').value),
              description: document.getElementById('description').value,
              date: document.getElementById('date').value
            };
            
            try {
              await axios.post('/api/transactions', data);
              
              // フォームリセット
              document.getElementById('transaction-form').reset();
              document.getElementById('date').valueAsDate = new Date();
              updateCategoryOptions();
              
              // データ再読み込み
              await loadTransactions();
              await loadSummary();
              
              alert('取引を保存しました');
            } catch (error) {
              console.error('Failed to create transaction:', error);
              alert('取引の保存に失敗しました');
            }
          }

          // 取引削除
          async function deleteTransaction(id) {
            if (!confirm('この取引を削除しますか？')) {
              return;
            }
            
            try {
              await axios.delete(\`/api/transactions/\${id}\`);
              await loadTransactions();
              await loadSummary();
            } catch (error) {
              console.error('Failed to delete transaction:', error);
              alert('削除に失敗しました');
            }
          }

          // 月変更
          async function handleMonthChange(e) {
            currentMonth = e.target.value;
            await loadTransactions();
            await loadSummary();
          }
        </script>
    </body>
    </html>
  `)
})

export default app

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { basicAuth } from 'hono/basic-auth'

type Bindings = {
  DB: D1Database;
  BASIC_AUTH_USERNAME?: string;
  BASIC_AUTH_PASSWORD?: string;
}

const app = new Hono<{ Bindings: Bindings }>()

// Basic認証（全体にかける）
app.use('*', async (c, next) => {
  // 環境変数から認証情報を取得（未設定の場合はデフォルト値）
  const username = c.env.BASIC_AUTH_USERNAME || 'admin'
  const password = c.env.BASIC_AUTH_PASSWORD || 'password123'
  
  const auth = basicAuth({
    username,
    password,
    realm: '家計簿アプリ',
  })
  
  return auth(c, next)
})

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
    
    // 各取引のタグを取得
    const transactions = await Promise.all(results.map(async (transaction: any) => {
      const { results: tags } = await c.env.DB.prepare(`
        SELECT t.id, t.name FROM tags t
        JOIN transaction_tags tt ON t.id = tt.tag_id
        WHERE tt.transaction_id = ?
        ORDER BY t.name
      `).bind(transaction.id).all()
      
      return {
        ...transaction,
        tags: tags || []
      }
    }))
    
    return c.json({ transactions })
  } catch (error) {
    console.error(error)
    return c.json({ error: 'Failed to fetch transactions' }, 500)
  }
})

// 取引作成
app.post('/api/transactions', async (c) => {
  try {
    const { type, amount, category_id, description, date, tag_ids } = await c.req.json()
    
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
    
    const transactionId = result.meta.last_row_id
    
    // タグを追加
    if (tag_ids && Array.isArray(tag_ids) && tag_ids.length > 0) {
      for (const tagId of tag_ids) {
        await c.env.DB.prepare(`
          INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)
        `).bind(transactionId, tagId).run()
      }
    }
    
    return c.json({ 
      id: transactionId,
      type,
      amount,
      category_id,
      description,
      date,
      tag_ids: tag_ids || []
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

// === タグ関連API ===

// タグ一覧取得
app.get('/api/tags', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(`
      SELECT * FROM tags ORDER BY name
    `).all()
    
    return c.json({ tags: results })
  } catch (error) {
    console.error(error)
    return c.json({ error: 'Failed to fetch tags' }, 500)
  }
})

// タグ作成
app.post('/api/tags', async (c) => {
  try {
    const { name } = await c.req.json()
    
    if (!name || name.trim() === '') {
      return c.json({ error: 'Tag name is required' }, 400)
    }
    
    const result = await c.env.DB.prepare(`
      INSERT INTO tags (name) VALUES (?)
    `).bind(name.trim()).run()
    
    return c.json({ 
      id: result.meta.last_row_id,
      name: name.trim()
    }, 201)
  } catch (error) {
    console.error(error)
    return c.json({ error: 'Failed to create tag' }, 500)
  }
})

// 取引にタグを追加
app.post('/api/transactions/:id/tags', async (c) => {
  try {
    const transactionId = c.req.param('id')
    const { tag_ids } = await c.req.json()
    
    if (!tag_ids || !Array.isArray(tag_ids)) {
      return c.json({ error: 'tag_ids array is required' }, 400)
    }
    
    // 既存のタグをクリア
    await c.env.DB.prepare(`
      DELETE FROM transaction_tags WHERE transaction_id = ?
    `).bind(transactionId).run()
    
    // 新しいタグを追加
    for (const tagId of tag_ids) {
      await c.env.DB.prepare(`
        INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)
      `).bind(transactionId, tagId).run()
    }
    
    return c.json({ success: true })
  } catch (error) {
    console.error(error)
    return c.json({ error: 'Failed to update transaction tags' }, 500)
  }
})

// 取引のタグ取得
app.get('/api/transactions/:id/tags', async (c) => {
  try {
    const transactionId = c.req.param('id')
    
    const { results } = await c.env.DB.prepare(`
      SELECT t.* FROM tags t
      JOIN transaction_tags tt ON t.id = tt.tag_id
      WHERE tt.transaction_id = ?
      ORDER BY t.name
    `).bind(transactionId).all()
    
    return c.json({ tags: results })
  } catch (error) {
    console.error(error)
    return c.json({ error: 'Failed to fetch transaction tags' }, 500)
  }
})

// タグ別集計
app.get('/api/summary/tags', async (c) => {
  try {
    const month = c.req.query('month')
    
    let query = `
      SELECT 
        t.id,
        t.name,
        COUNT(DISTINCT tr.id) as transaction_count,
        SUM(CASE WHEN tr.type = 'income' THEN tr.amount ELSE 0 END) as total_income,
        SUM(CASE WHEN tr.type = 'expense' THEN tr.amount ELSE 0 END) as total_expense
      FROM tags t
      LEFT JOIN transaction_tags tt ON t.id = tt.tag_id
      LEFT JOIN transactions tr ON tt.transaction_id = tr.id
    `
    
    if (month) {
      query += ` WHERE tr.date LIKE '${month}%'`
    }
    
    query += ` GROUP BY t.id, t.name ORDER BY t.name`
    
    const { results } = await c.env.DB.prepare(query).all()
    
    return c.json({ tag_summary: results })
  } catch (error) {
    console.error(error)
    return c.json({ error: 'Failed to fetch tag summary' }, 500)
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
                    <div class="mb-4">
                        <label class="block text-gray-700 font-semibold mb-2">
                            <i class="fas fa-tags mr-1"></i>タグ
                        </label>
                        <div class="flex gap-2 mb-2">
                            <input type="text" id="new-tag" class="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" placeholder="新しいタグを入力">
                            <button type="button" onclick="addNewTag()" class="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition">
                                <i class="fas fa-plus"></i> 追加
                            </button>
                        </div>
                        <div id="tag-selection" class="flex flex-wrap gap-2">
                            <!-- タグがここに表示されます -->
                        </div>
                    </div>
                    <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg transition duration-200">
                        <i class="fas fa-save mr-2"></i>
                        保存
                    </button>
                </form>
            </div>

            <!-- 取引履歴 -->
            <div class="bg-white rounded-lg shadow-md p-6 mb-6">
                <h2 class="text-xl font-bold text-gray-800 mb-4">
                    <i class="fas fa-history mr-2 text-blue-600"></i>
                    取引履歴
                </h2>
                <div id="transactions-list" class="space-y-3">
                    <p class="text-gray-500 text-center py-8">取引履歴がありません</p>
                </div>
            </div>

            <!-- タグ別集計 -->
            <div class="bg-white rounded-lg shadow-md p-6">
                <h2 class="text-xl font-bold text-gray-800 mb-4">
                    <i class="fas fa-chart-bar mr-2 text-blue-600"></i>
                    タグ別集計
                </h2>
                <div id="tag-summary" class="space-y-2">
                    <p class="text-gray-500 text-center py-8">タグがありません</p>
                </div>
            </div>
        </div>

        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        <script>
          // グローバル変数
          let categories = [];
          let tags = [];
          let selectedTagIds = [];
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
            await loadTags();
            await loadTransactions();
            await loadSummary();
            await loadTagSummary();

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

          // タグ読み込み
          async function loadTags() {
            try {
              const response = await axios.get('/api/tags');
              tags = response.data.tags;
              renderTagSelection();
            } catch (error) {
              console.error('Failed to load tags:', error);
            }
          }

          // タグ選択UI表示
          function renderTagSelection() {
            const container = document.getElementById('tag-selection');
            if (tags.length === 0) {
              container.innerHTML = '<p class="text-gray-500 text-sm">タグがありません</p>';
              return;
            }
            
            container.innerHTML = tags.map(tag => {
              const isSelected = selectedTagIds.includes(tag.id);
              return \`
                <button type="button" 
                  onclick="toggleTag(\${tag.id})"
                  class="px-3 py-1 rounded-full text-sm transition \${
                    isSelected 
                      ? 'bg-blue-600 text-white' 
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }">
                  <i class="fas fa-tag mr-1"></i>\${tag.name}
                </button>
              \`;
            }).join('');
          }

          // タグ選択切り替え
          function toggleTag(tagId) {
            const index = selectedTagIds.indexOf(tagId);
            if (index > -1) {
              selectedTagIds.splice(index, 1);
            } else {
              selectedTagIds.push(tagId);
            }
            renderTagSelection();
          }

          // 新しいタグ追加
          async function addNewTag() {
            const input = document.getElementById('new-tag');
            const tagName = input.value.trim();
            
            if (!tagName) {
              alert('タグ名を入力してください');
              return;
            }
            
            try {
              const response = await axios.post('/api/tags', { name: tagName });
              tags.push(response.data);
              input.value = '';
              renderTagSelection();
            } catch (error) {
              console.error('Failed to create tag:', error);
              alert('タグの作成に失敗しました');
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
                <div class="transaction-\${t.type} bg-gray-50 rounded-lg p-4 hover:bg-gray-100 transition">
                  <div class="flex items-center justify-between mb-2">
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
                  \${t.tags && t.tags.length > 0 ? \`
                    <div class="flex flex-wrap gap-1 mt-2">
                      \${t.tags.map(tag => \`
                        <span class="px-2 py-1 bg-blue-100 text-blue-700 rounded-full text-xs">
                          <i class="fas fa-tag mr-1"></i>\${tag.name}
                        </span>
                      \`).join('')}
                    </div>
                  \` : ''}
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

          // タグ別集計読み込み
          async function loadTagSummary() {
            try {
              const response = await axios.get(\`/api/summary/tags?month=\${currentMonth}\`);
              const tagSummary = response.data.tag_summary;
              
              const container = document.getElementById('tag-summary');
              
              if (tagSummary.length === 0) {
                container.innerHTML = '<p class="text-gray-500 text-center py-8">タグがありません</p>';
                return;
              }
              
              container.innerHTML = tagSummary.map(tag => \`
                <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div class="flex items-center space-x-2">
                    <i class="fas fa-tag text-blue-600"></i>
                    <span class="font-semibold text-gray-800">\${tag.name}</span>
                    <span class="text-xs text-gray-500">(\${tag.transaction_count}件)</span>
                  </div>
                  <div class="flex space-x-4 text-sm">
                    <span class="text-green-600">収入: ¥\${tag.total_income.toLocaleString()}</span>
                    <span class="text-red-600">支出: ¥\${tag.total_expense.toLocaleString()}</span>
                  </div>
                </div>
              \`).join('');
            } catch (error) {
              console.error('Failed to load tag summary:', error);
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
              date: document.getElementById('date').value,
              tag_ids: selectedTagIds
            };
            
            try {
              await axios.post('/api/transactions', data);
              
              // フォームリセット
              document.getElementById('transaction-form').reset();
              document.getElementById('date').valueAsDate = new Date();
              selectedTagIds = [];
              updateCategoryOptions();
              renderTagSelection();
              
              // データ再読み込み
              await loadTransactions();
              await loadSummary();
              await loadTagSummary();
              
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
              await loadTagSummary();
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
            await loadTagSummary();
          }
        </script>
    </body>
    </html>
  `)
})

export default app

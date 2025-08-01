// --- SECTION NAVIGATION ---
function showSection(id) {
  // Hide all sections
  document.querySelectorAll("section").forEach(sec => sec.style.display = "none");
  // Show the requested section
  const section = document.getElementById(id);
  if (section) section.style.display = "block";

  // Remove 'active' from all tabs
  document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));

  // Add 'active' only if tab exists!
  if(id === 'home') {
    const tab = document.querySelectorAll('.tab')[0];
    if (tab) tab.classList.add('active');
  }
  if(id === 'smart-split') {
    const tab = document.querySelectorAll('.tab')[1];
    if (tab) tab.classList.add('active');
  }
  if(id === 'tracker') {
    const tab = document.querySelectorAll('.tab')[2];
    if (tab) tab.classList.add('active');
  }
}

// Show home on load
showSection('home');

// --- SMART SPLIT (LOCAL MODE ONLY, NO SESSION) ---
let splitItems = [];

const db = firebase.firestore();
let sessionId = null;
let unsubscribeSession = null;

function getSessionIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('session');
}
sessionId = getSessionIdFromUrl();

function renderSplitItems() {
  const listDiv = document.getElementById('itemList');
  listDiv.innerHTML = '';
  splitItems.forEach(item => {
    listDiv.innerHTML += `<div class='item-block' style='margin-bottom:10px; padding:8px 13px; background:#f6fcff;border-radius:1em;'>
      <strong>${item.name}</strong> – ₹${item.price}<br>
      <small>Paid by: ${item.paidBy} | Shared: ${item.shared} | Payer in split: ${item.payerIncluded ? 'Yes' : 'No'}</small>
    </div>`;
  });
}

// --- CREATE OR SHOW SESSION SHARE LINK ---
document.getElementById('shareSessionBtn').onclick = async function() {
  if (!sessionId) {
    // Create new session in Firestore
    const docRef = await db.collection('smart_split_sessions').add({items: []});
    sessionId = docRef.id;
    window.history.replaceState({}, '', '?session=' + sessionId);
    startSessionSync(sessionId);
  }
  // Show the share link
  const link = window.location.origin + window.location.pathname + '?session=' + sessionId;
  const box = document.getElementById('sessionLinkBox');
  box.style.display = 'block';
  box.innerHTML = `<strong>Share this link:</strong><br>
    <input type="text" value="${link}" readonly style="width:80%;padding:4px;">
    <button onclick="navigator.clipboard.writeText('${link}')">Copy</button>`;
};

function startSessionSync(sessionId) {
  if (unsubscribeSession) unsubscribeSession();
  unsubscribeSession = db.collection('smart_split_sessions').doc(sessionId)
    .onSnapshot(doc => {
      const data = doc.data();
      if (!data) return;
      splitItems = data.items || [];
      renderSplitItems();
    });
}

// On load, if in session, start sync
if (sessionId) startSessionSync(sessionId);

document.getElementById('addItemBtn').onclick = function() {
  const name = document.querySelector('.item-name').value,
        price = parseFloat(document.querySelector('.item-price').value),
        paidBy = document.querySelector('.payer').value,
        shared = document.querySelector('.sharers').value,
        payerIncluded = document.querySelector('.include-payer').checked;
  if(!name||!price||!paidBy||!shared) return alert('Fill all fields!');
  if (sessionId) {
  // Collaborative mode: update Firestore
  const sessionRef = db.collection('smart_split_sessions').doc(sessionId);
  sessionRef.get().then(doc => {
    let items = doc.exists ? doc.data().items || [] : [];
    items.push({name,price,paidBy,shared,payerIncluded});
    sessionRef.update({items});
  });
} else {
  // Local mode
  splitItems.push({name,price,paidBy,shared,payerIncluded});
  renderSplitItems();
}
  document.querySelector('.item-name').value = "";
  document.querySelector('.item-price').value = "";
  document.querySelector('.payer').value = "";
  document.querySelector('.sharers').value = "";
  document.querySelector('.include-payer').checked = false;
};

document.getElementById('clearAllBtn').onclick = function() {
  if(confirm("Clear all entries?")) {
    if (sessionId) {
      db.collection('smart_split_sessions').doc(sessionId).update({items: []});
    } else {
      splitItems = [];
      renderSplitItems();
      document.getElementById('result').innerHTML = '';
    }
  }
};

document.getElementById('calculateBtn').onclick = function() {
  if(!splitItems.length) return alert('No items to calculate!');
  let balances = {};
  splitItems.forEach(item=>{
    let {price,paidBy,shared,payerIncluded}=item;
    paidBy=paidBy.trim().toLowerCase();
    let sharers=shared.split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
    if(payerIncluded) sharers.push(paidBy);
    sharers=[...new Set(sharers)];
    let splitAmt=price/sharers.length;
    sharers.forEach(person=>{balances[person]=(balances[person]||0)-splitAmt;});
    balances[paidBy]=(balances[paidBy]||0)+price;
  });
  let people=Object.keys(balances),
      owes=people.filter(p=>balances[p]<-0.01).map(p=>[p,balances[p]]),
      gets=people.filter(p=>balances[p]>0.01).map(p=>[p,balances[p]]),
      settlements=[];
  owes.sort((a,b)=>a[1]-b[1]); gets.sort((a,b)=>b[1]-a[1]);
  let i=0,j=0;
  while(i<owes.length && j<gets.length){
    let oweName=owes[i][0], oweAmt=-owes[i][1],
        getName=gets[j][0], getAmt=gets[j][1],
        pay=Math.min(oweAmt,getAmt);
    if(pay>0.01) settlements.push(`${oweName} pays ₹${pay.toFixed(2)} to ${getName}`);
    owes[i][1]+=pay; gets[j][1]-=pay;
    if(Math.abs(owes[i][1])<0.01) i++;
    if(gets[j][1]<0.01) j++;
  }
  let html='<div class="result-block"><b>Final Settlement</b><ul>';
  people.forEach(p=>{html+=`<li>${p} balance: ₹${balances[p].toFixed(2)}</li>`;});
  html+='</ul><b>Who Pays Whom</b><ul>';
  settlements.forEach(set=>{html+=`<li>${set}</li>`;});
  html+='</ul></div>';
  document.getElementById('result').innerHTML=html;
};



// ================== EXPENSE TRACKER =======================
let transactions = JSON.parse(localStorage.getItem('transactions') || '[]');

document.getElementById('transaction-form').onsubmit = function(e) {
  e.preventDefault();
  const amount = parseFloat(document.getElementById('amount').value);
  const category = document.getElementById('category').value.trim();
  const type = document.getElementById('type').value;
  const date = document.getElementById('date').value;
  if (!amount || !category || !date) return;
  transactions.push({ date, category, amount, type });
  localStorage.setItem('transactions', JSON.stringify(transactions));
  renderTransactions();
  renderCharts();
  showMetrics();
  document.getElementById('add-msg').textContent = "Transaction added!";
  setTimeout(()=>document.getElementById('add-msg').textContent='', 1600);
  this.reset();
};

function renderTransactions() {
  const tbody = document.querySelector('#transactions tbody');
  tbody.innerHTML = '';
  transactions.forEach(t => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${t.date}</td><td>${t.category}</td><td>₹${t.amount.toFixed(2)}</td><td>${t.type}</td>`;
    tbody.appendChild(tr);
  });
}
renderTransactions();

document.getElementById('download-csv').onclick = function() {
  const rows = [["Date","Category","Amount","Type"], ...transactions.map(t => [t.date, t.category, t.amount, t.type])];
  const csv = rows.map(r => r.join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv,' + encodeURIComponent(csv);
  a.download = "backup_transactions.csv";
  a.click();
};

document.getElementById('reset-btn').onclick = function() {
  if (!document.getElementById('confirm-reset').checked) {
    alert("Please confirm to reset.");
    return;
  }
  if (confirm("Clear all transactions?")) {
    transactions = [];
    localStorage.setItem('transactions', '[]');
    renderTransactions();
    renderCharts();
    showMetrics();
  }
};

// -------------------- CHARTS ----------------------
let incExpChart, catChart;
function renderCharts() {
  // Income vs Expense
  const income = transactions.filter(t=>t.type=="Income").reduce((a,t)=>a+t.amount,0);
  const expense = transactions.filter(t=>t.type=="Expense").reduce((a,t)=>a+t.amount,0);
  const ctx1 = document.getElementById('incomeExpenseChart').getContext('2d');
  if (incExpChart) incExpChart.destroy();
  incExpChart = new Chart(ctx1, {
    type: 'pie',
    data: {
      labels: ["Income", "Expense"],
      datasets: [{ data: [income, expense], backgroundColor: ["#1f77b4", "#ff7f0e"] }]
    },
    options: { plugins: { legend: { labels: { color: "#222" } } } }
  });
  // Category Chart
  const expenseByCat = {};
  transactions.filter(t=>t.type=="Expense").forEach(t => {
    expenseByCat[t.category] = (expenseByCat[t.category]||0) + t.amount;
  });
  const ctx2 = document.getElementById('expenseCategoryChart').getContext('2d');
  if (catChart) catChart.destroy();
  catChart = new Chart(ctx2, {
    type: 'pie',
    data: {
      labels: Object.keys(expenseByCat),
      datasets: [{ data: Object.values(expenseByCat), backgroundColor: ["#ff7f0e", "#76c7c0", "#f4d35e", "#bc6c25", "#1f77b4"] }]
    },
    options: { plugins: { legend: { labels: { color: "#222" } } } }
  });
}
renderCharts();

function showMetrics() {
  const income = transactions.filter(t=>t.type=="Income").reduce((a,t)=>a+t.amount,0);
  const expense = transactions.filter(t=>t.type=="Expense").reduce((a,t)=>a+t.amount,0);
  const balance = income - expense;
  document.getElementById('metrics').innerHTML =
    `<b>Total Income:</b> ₹${income.toFixed(2)}<br>
     <b>Total Expense:</b> ₹${expense.toFixed(2)}<br>
     <b>Balance:</b> ₹${balance.toFixed(2)}`;
}
showMetrics();

// --------------- AI ADVICE (Rule-based) ---------------
document.getElementById('ai-form').onsubmit = function(e) {
  e.preventDefault();
  const question = document.getElementById('ai-question').value.trim().toLowerCase();
  let response = "Sorry, no advice available.";

  if (question.includes("save")) {
    response = "• Track your expenses\n• Set a monthly budget\n• Follow the 50-30-20 rule: 50% needs, 30% wants, 20% savings.";
  } else if (question.includes("invest")) {
    response = "• Start investing early\n• Consider mutual funds/index funds\n• Diversify your investments.";
  } else if (question.includes("debt")) {
    response = "• Pay high-interest debts first\n• Avoid new unnecessary loans\n• Always pay at least the minimum due.";
  } else if (question.includes("budget")) {
    response = "• List income & expenses\n• Set realistic limits\n• Review your budget monthly.";
  } else if (question.includes("emergency fund")) {
    response = "• Save 3-6 months of expenses\n• Add a fixed amount each month.";
  }

  document.getElementById('ai-response').textContent = response;
}

if (sessionId) document.getElementById('shareSessionBtn').style.display = "none";


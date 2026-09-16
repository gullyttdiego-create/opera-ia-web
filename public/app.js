const app = document.getElementById("app");

const menu = [
  ["dashboard", "📊", "Dashboard"],
  ["contratos", "🏢", "Contratos / CR"],
  ["postos", "📍", "Postos"],
  ["colaboradores", "👥", "Colaboradores"],
  ["importar", "📥", "Importar Planilha"],
  ["coberturas", "🤖", "Coberturas IA"],
  ["extras", "⏱️", "Horas Extras"],
  ["ponto", "📄", "Folha de Ponto"],
  ["treinamentos", "🎓", "Treinamentos"],
  ["pendencias", "⚠️", "Pendências"],
  ["relatorios", "📈", "Relatórios"],
  ["administracao", "⚙️", "Administração"]
];

function dashboard() {
  return `
    <div class="page-header">
      <div>
        <h1>Dashboard</h1>
        <p>Visão geral das operações</p>
      </div>
      <button class="primary">+ Nova Cobertura</button>
    </div>

    <div class="cards">
      <div class="card">
        <span>Contratos ativos</span>
        <strong>0</strong>
        <small>Contratos cadastrados</small>
      </div>

      <div class="card">
        <span>Colaboradores</span>
        <strong>0</strong>
        <small>Colaboradores ativos</small>
      </div>

      <div class="card">
        <span>Coberturas</span>
        <strong>0</strong>
        <small>No mês atual</small>
      </div>

      <div class="card">
        <span>Pendências</span>
        <strong>0</strong>
        <small>Aguardando ação</small>
      </div>
    </div>

    <div class="dashboard-grid">
      <div class="panel">
        <div class="panel-title">
          <h3>Coberturas recentes</h3>
          <button>Ver todas</button>
        </div>

        <div class="empty">
          <div class="empty-icon">🤖</div>
          <h3>Nenhuma cobertura registrada</h3>
          <p>As coberturas realizadas aparecerão aqui.</p>
        </div>
      </div>

      <div class="panel">
        <div class="panel-title">
          <h3>Central de Pendências</h3>
        </div>

        <div class="pending-item">
          <span>📄 Folhas de ponto</span>
          <strong>0</strong>
        </div>

        <div class="pending-item">
          <span>🎓 Treinamentos</span>
          <strong>0</strong>
        </div>

        <div class="pending-item">
          <span>⚠️ Outras solicitações</span>
          <strong>0</strong>
        </div>
      </div>
    </div>
  `;
}

function genericPage(title) {
  return `
    <div class="page-header">
      <div>
        <h1>${title}</h1>
        <p>Módulo OPERA IA</p>
      </div>
    </div>

    <div class="panel">
      <div class="empty">
        <div class="empty-icon">🚧</div>
        <h3>${title}</h3>
        <p>Este módulo está pronto para receber as próximas funções.</p>
      </div>
    </div>
  `;
}

function render(page = "dashboard") {
  const current = menu.find(item => item[0] === page);
  const title = current ? current[2] : "Dashboard";

  app.innerHTML = `
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-icon">O</div>
        <div>
          <strong>OPERA IA</strong>
          <small>Gestão Inteligente</small>
        </div>
      </div>

      <nav>
        ${menu.map(item => `
          <button
            class="nav-item ${page === item[0] ? "active" : ""}"
            onclick="render('${item[0]}')">
            <span>${item[1]}</span>
            ${item[2]}
          </button>
        `).join("")}
      </nav>

      <div class="sidebar-footer">
        <div class="user-avatar">AD</div>
        <div>
          <strong>Administrador</strong>
          <small>ADM</small>
        </div>
      </div>
    </aside>

    <main class="main">
      <header class="topbar">
        <div>
          <strong>OPERA IA</strong>
          <span>A inteligência que conecta pessoas às operações.</span>
        </div>
        <div class="status">
          <span class="online"></span>
          Sistema online
        </div>
      </header>

      <section class="content">
        ${page === "dashboard" ? dashboard() : genericPage(title)}
      </section>
    </main>
  `;
}

render();

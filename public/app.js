const app = document.getElementById("app");

let token = localStorage.getItem("opera_token") || "";
let currentUser = JSON.parse(localStorage.getItem("opera_user") || "null");
let currentPage = "dashboard";
let installPrompt = null;
let activeCoverageSession = null;
let activeRequestSendQueue = [];

let cache = {
  contracts: [],
  posts: [],
  employees: [],
  requests: [],
  coverages: []
};

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

/* =========================
   API
========================= */

async function api(url, options = {}) {
  const headers = {
    ...(options.headers || {})
  };

  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers
  });

  const data = await response
    .json()
    .catch(() => ({}));

  if (response.status === 401 && token) {
    logout();
    throw new Error("Sua sessão expirou.");
  }

  if (!response.ok) {
    throw new Error(
      data.error ||
      "Não foi possível concluir a operação."
    );
  }

  return data;
}

function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function moneyHours(value) {
  return Number(value || 0)
    .toLocaleString("pt-BR", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 2
    });
}

function dateBR(value) {
  if (!value) return "-";

  const text = String(value).slice(0, 10);
  const [y, m, d] = text.split("-");

  return `${d}/${m}/${y}`;
}

function notify(message, type = "success") {
  const old = document.querySelector(".toast");
  if (old) old.remove();

  const div = document.createElement("div");
  div.className = `toast ${type}`;
  div.textContent = message;

  document.body.appendChild(div);

  setTimeout(() => div.remove(), 3500);
}

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  installPrompt = event;
  document.body.classList.add("pwa-installable");
});

window.addEventListener("appinstalled", () => {
  installPrompt = null;
  document.body.classList.remove("pwa-installable");
  notify("OPERA IA instalado com sucesso.");
});

async function installApp() {
  if (!installPrompt) return;

  await installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  document.body.classList.remove("pwa-installable");
}

/* =========================
   AUTENTICAÇÃO
========================= */

function authScreen(title, subtitle, fields, button, action) {
  app.innerHTML = `
    <div class="auth-page">
      <div class="auth-card">

        <div class="auth-logo">O</div>

        <h1>OPERA IA</h1>

        <p class="auth-slogan">
          A inteligência que conecta pessoas às operações.
        </p>

        <div class="auth-divider"></div>

        <h2>${title}</h2>

        <p class="auth-description">
          ${subtitle}
        </p>

        <form id="authForm">
          ${fields}

          <div
            id="authMessage"
            class="auth-message">
          </div>

          <button
            type="submit"
            class="primary auth-button">
            ${button}
          </button>
        </form>

      </div>
    </div>
  `;

  document
    .getElementById("authForm")
    .addEventListener("submit", action);
}

function setupScreen() {
  authScreen(
    "Primeiro acesso",
    "Crie o administrador principal.",
    `
      <label>
        Nome
        <input id="name" required>
      </label>

      <label>
        E-mail
        <input id="email" type="email" required>
      </label>

      <label>
        Senha
        <input
          id="password"
          type="password"
          minlength="8"
          required>
      </label>

      <label>
        Confirmar senha
        <input
          id="confirmPassword"
          type="password"
          minlength="8"
          required>
      </label>
    `,
    "Criar administrador",
    createAdmin
  );
}

async function createAdmin(event) {
  event.preventDefault();

  const message =
    document.getElementById("authMessage");

  const password =
    document.getElementById("password").value;

  if (
    password !==
    document.getElementById("confirmPassword").value
  ) {
    message.textContent =
      "As senhas não coincidem.";

    message.className =
      "auth-message error";

    return;
  }

  try {
    await api("/api/setup", {
      method: "POST",
      body: JSON.stringify({
        name:
          document.getElementById("name").value,
        email:
          document.getElementById("email").value,
        password
      })
    });

    loginScreen(
      "Administrador criado. Faça seu login."
    );
  } catch (error) {
    message.textContent = error.message;
    message.className =
      "auth-message error";
  }
}

function loginScreen(success = "") {
  authScreen(
    "Acessar sistema",
    "Entre com suas credenciais.",
    `
      ${
        success
          ? `<div class="success-box">${esc(success)}</div>`
          : ""
      }

      <label>
        E-mail
        <input
          id="email"
          type="email"
          required>
      </label>

      <label>
        Senha
        <input
          id="password"
          type="password"
          required>
      </label>
    `,
    "Entrar",
    login
  );
}

async function login(event) {
  event.preventDefault();

  const message =
    document.getElementById("authMessage");

  try {
    message.textContent = "Entrando...";

    const data = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({
        email:
          document.getElementById("email").value,
        password:
          document.getElementById("password").value
      })
    });

    token = data.token;
    currentUser = data.user;

    localStorage.setItem(
      "opera_token",
      token
    );

    localStorage.setItem(
      "opera_user",
      JSON.stringify(currentUser)
    );

    render("dashboard");
  } catch (error) {
    message.textContent = error.message;
    message.className =
      "auth-message error";
  }
}

function logout() {
  token = "";
  currentUser = null;

  localStorage.removeItem("opera_token");
  localStorage.removeItem("opera_user");

  loginScreen();
}

/* =========================
   LAYOUT
========================= */

async function render(page = "dashboard") {
  currentPage = page;

  const item =
    menu.find(x => x[0] === page);

  const title =
    item ? item[2] : "Dashboard";

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
            class="nav-item ${
              page === item[0]
                ? "active"
                : ""
            }"
            onclick="render('${item[0]}')">

            <span>${item[1]}</span>
            ${item[2]}

          </button>
        `).join("")}
      </nav>

      <div class="sidebar-footer">

        <div class="user-avatar">
          ${esc(
            currentUser?.name
              ?.substring(0, 2)
              .toUpperCase() || "AD"
          )}
        </div>

        <div>
          <strong>
            ${esc(currentUser?.name || "")}
          </strong>

          <small>
            ${esc(currentUser?.role || "")}
          </small>
        </div>

      </div>

    </aside>

    <main class="main">

      <header class="topbar">

        <div>
          <strong>OPERA IA</strong>

          <span>
            A inteligência que conecta pessoas às operações.
          </span>
        </div>

        <div class="topbar-actions">

          <button
            class="install-button"
            onclick="installApp()">
            Instalar app
          </button>

          <div class="status">
            <span class="online"></span>
            Sistema online
          </div>

          <button
            class="logout-button"
            onclick="logout()">
            Sair
          </button>

        </div>

      </header>

      <section
        id="pageContent"
        class="content">

        <div class="empty">
          Carregando...
        </div>

      </section>

    </main>
  `;

  try {
    let html = "";

    switch (page) {
      case "dashboard":
        html = await dashboardPage();
        break;

      case "contratos":
        html = await contractsPage();
        break;

      case "postos":
        html = await postsPage();
        break;

      case "colaboradores":
        html = await employeesPage();
        break;

      case "importar":
        html = importPage();
        break;

      case "coberturas":
        html = await coveragesPage();
        break;

      case "extras":
        html = await overtimePage();
        break;

      case "ponto":
        html = await requestPage("FOLHA_PONTO");
        break;

      case "treinamentos":
        html = await requestPage("TREINAMENTO");
        break;

      case "pendencias":
        html = await pendingPage();
        break;

      case "relatorios":
        html = await reportsPage();
        break;

      case "administracao":
        html = await adminPage();
        break;

      default:
        html = `<h1>${esc(title)}</h1>`;
    }

    document.getElementById(
      "pageContent"
    ).innerHTML = html;

  } catch (error) {
    document.getElementById(
      "pageContent"
    ).innerHTML = `
      <div class="panel">
        <div class="empty">
          <div class="empty-icon">⚠️</div>
          <h3>Não foi possível carregar</h3>
          <p>${esc(error.message)}</p>
        </div>
      </div>
    `;
  }
}

/* =========================
   DASHBOARD
========================= */

async function dashboardPage() {
  const data =
    await api("/api/dashboard");

  return `
    <div class="page-header">
      <div>
        <h1>Dashboard</h1>
        <p>
          Visão geral das operações
        </p>
      </div>

      <button
        class="primary"
        onclick="render('coberturas')">
        + Nova Cobertura
      </button>
    </div>

    <div class="cards">

      ${card(
        "Contratos ativos",
        data.contracts,
        "Contratos cadastrados"
      )}

      ${card(
        "Postos",
        data.posts,
        "Postos operacionais"
      )}

      ${card(
        "Colaboradores",
        data.employees,
        "Colaboradores ativos"
      )}

      ${card(
        "Horas extras",
        `${moneyHours(data.overtime)}h`,
        "Mês atual"
      )}

    </div>

    <div class="dashboard-grid">

      <div class="panel">

        <div class="panel-title">
          <h3>Coberturas</h3>
        </div>

        <div class="metric-big">
          ${data.coverages_today || 0}
        </div>

        <p class="muted">
          Coberturas registradas hoje
        </p>

        <button
          class="primary"
          onclick="render('coberturas')">
          Abrir Coberturas IA
        </button>

      </div>

      <div class="panel">

        <div class="panel-title">
          <h3>Central de Pendências</h3>
        </div>

        <div class="metric-big">
          ${data.pending || 0}
        </div>

        <p class="muted">
          Solicitações aguardando ação
        </p>

        <button
          class="secondary"
          onclick="render('pendencias')">
          Ver pendências
        </button>

      </div>

    </div>
  `;
}

function card(title, value, subtitle) {
  return `
    <div class="card">
      <span>${title}</span>
      <strong>${value || 0}</strong>
      <small>${subtitle}</small>
    </div>
  `;
}

/* =========================
   CONTRATOS
========================= */

async function contractsPage() {
  cache.contracts =
    await api("/api/contracts");

  return `
    <div class="page-header">
      <div>
        <h1>Contratos / CR</h1>
        <p>
          Cadastro e gestão dos contratos
        </p>
      </div>

      <button
        class="primary"
        onclick="showContractForm()">
        + Novo Contrato
      </button>
    </div>

    <div id="formArea"></div>

    <div class="panel">
      <div class="panel-title">
        <h3>
          Contratos cadastrados
        </h3>

        <span>
          ${cache.contracts.length}
        </span>
      </div>

      ${
        cache.contracts.length
          ? `
          <div class="table-wrap">
            <table class="data-table">

              <thead>
                <tr>
                  <th>CR</th>
                  <th>Contrato</th>
                  <th>Postos</th>
                  <th>Colaboradores</th>
                  <th>Status</th>
                  <th>Ação</th>
                </tr>
              </thead>

              <tbody>
                ${cache.contracts.map(c => `
                  <tr>
                    <td>
                      <strong>
                        ${esc(c.cr)}
                      </strong>
                    </td>

                    <td>${esc(c.name)}</td>

                    <td>${c.posts || 0}</td>

                    <td>
                      ${c.employees || 0}
                    </td>

                    <td>
                      ${statusBadge(
                        c.active
                          ? "ATIVO"
                          : "INATIVO"
                      )}
                    </td>

                    <td>
                      <button
                        class="small-button"
                        onclick="toggleContract(
                          ${c.id},
                          ${!c.active}
                        )">
                        ${
                          c.active
                            ? "Desativar"
                            : "Reativar"
                        }
                      </button>
                    </td>
                  </tr>
                `).join("")}
              </tbody>

            </table>
          </div>
          `
          : empty(
              "🏢",
              "Nenhum contrato",
              "Cadastre seu primeiro contrato."
            )
      }
    </div>
  `;
}

function showContractForm() {
  document.getElementById("formArea").innerHTML = `
    <div class="panel form-panel">

      <div class="panel-title">
        <h3>Novo Contrato</h3>

        <button
          onclick="
            document.getElementById('formArea').innerHTML=''
          ">
          ✕
        </button>
      </div>

      <form
        class="form-grid"
        onsubmit="saveContract(event)">

        <label>
          CR
          <input
            id="contractCR"
            required
            placeholder="Código CR">
        </label>

        <label>
          Nome do contrato
          <input
            id="contractName"
            required
            placeholder="Ex.: Buriti Shopping">
        </label>

        <div class="form-actions">
          <button class="primary">
            Salvar Contrato
          </button>
        </div>

      </form>
    </div>
  `;
}

async function saveContract(event) {
  event.preventDefault();

  try {
    await api("/api/contracts", {
      method: "POST",
      body: JSON.stringify({
        cr:
          document.getElementById(
            "contractCR"
          ).value,

        name:
          document.getElementById(
            "contractName"
          ).value
      })
    });

    notify("Contrato salvo.");
    render("contratos");

  } catch (error) {
    notify(error.message, "error");
  }
}

async function toggleContract(id, active) {
  const contract =
    cache.contracts.find(
      c => c.id === id
    );

  if (!contract) return;

  await api(`/api/contracts/${id}`, {
    method: "PUT",
    body: JSON.stringify({
      cr: contract.cr,
      name: contract.name,
      active
    })
  });

  notify(
    active
      ? "Contrato reativado."
      : "Contrato desativado."
  );

  render("contratos");
}

/* =========================
   POSTOS
========================= */

async function postsPage() {
  cache.contracts =
    await api("/api/contracts");

  cache.posts =
    await api("/api/posts");

  return `
    <div class="page-header">

      <div>
        <h1>Postos</h1>
        <p>
          Postos vinculados aos contratos
        </p>
      </div>

      <button
        class="primary"
        onclick="showPostForm()">
        + Novo Posto
      </button>

    </div>

    <div id="formArea"></div>

    <div class="panel">

      ${
        cache.posts.length
          ? `
          <div class="table-wrap">
            <table class="data-table">

              <thead>
                <tr>
                  <th>CR</th>
                  <th>Contrato</th>
                  <th>Posto</th>
                  <th>Colaboradores</th>
                  <th>Status</th>
                </tr>
              </thead>

              <tbody>
                ${cache.posts.map(p => `
                  <tr>
                    <td>${esc(p.cr)}</td>
                    <td>
                      ${esc(p.contract_name)}
                    </td>
                    <td>
                      <strong>
                        ${esc(p.name)}
                      </strong>
                    </td>
                    <td>
                      ${p.employees || 0}
                    </td>
                    <td>
                      ${statusBadge(
                        p.active
                          ? "ATIVO"
                          : "INATIVO"
                      )}
                    </td>
                  </tr>
                `).join("")}
              </tbody>

            </table>
          </div>
          `
          : empty(
              "📍",
              "Nenhum posto",
              "Cadastre os postos dos seus contratos."
            )
      }

    </div>
  `;
}

function showPostForm() {
  document.getElementById("formArea").innerHTML = `
    <div class="panel form-panel">

      <div class="panel-title">
        <h3>Novo Posto</h3>

        <button
          onclick="
            document.getElementById('formArea').innerHTML=''
          ">
          ✕
        </button>
      </div>

      <form
        class="form-grid"
        onsubmit="savePost(event)">

        <label>
          Contrato
          <select
            id="postContract"
            required>

            <option value="">
              Selecione
            </option>

            ${activeContractsOptions()}

          </select>
        </label>

        <label>
          Nome do posto
          <input
            id="postName"
            required
            placeholder="Ex.: Portaria P2">
        </label>

        <label class="full">
          Descrição
          <input
            id="postDescription"
            placeholder="Opcional">
        </label>

        <div class="form-actions">
          <button class="primary">
            Salvar Posto
          </button>
        </div>

      </form>
    </div>
  `;
}

async function savePost(event) {
  event.preventDefault();

  try {
    await api("/api/posts", {
      method: "POST",
      body: JSON.stringify({
        contract_id:
          document.getElementById(
            "postContract"
          ).value,

        name:
          document.getElementById(
            "postName"
          ).value,

        description:
          document.getElementById(
            "postDescription"
          ).value
      })
    });

    notify("Posto cadastrado.");
    render("postos");

  } catch (error) {
    notify(error.message, "error");
  }
}

/* =========================
   COLABORADORES
========================= */

async function employeesPage() {
  cache.contracts =
    await api("/api/contracts");

  cache.posts =
    await api("/api/posts");

  cache.employees =
    await api("/api/employees");

  return `
    <div class="page-header">

      <div>
        <h1>Colaboradores</h1>

        <p>
          Gestão da equipe operacional
        </p>
      </div>

      <button
        class="primary"
        onclick="showEmployeeForm()">
        + Novo Colaborador
      </button>

    </div>

    <div id="formArea"></div>

    <div class="panel">

      <div class="toolbar">

        <input
          id="employeeSearch"
          placeholder="Buscar nome ou matrícula..."
          oninput="filterEmployees()">

        <select
          id="employeeContractFilter"
          onchange="filterEmployees()">

          <option value="">
            Todos os contratos
          </option>

          ${activeContractsOptions()}

        </select>

      </div>

      <div id="employeeTable">
        ${employeeTable(cache.employees)}
      </div>

    </div>
  `;
}

function employeeTable(items) {
  if (!items.length) {
    return empty(
      "👥",
      "Nenhum colaborador",
      "Cadastre ou importe sua equipe."
    );
  }

  return `
    <div class="table-wrap">

      <table class="data-table">

        <thead>
          <tr>
            <th>Matrícula</th>
            <th>Nome</th>
            <th>Contrato</th>
            <th>Posto</th>
            <th>Função</th>
            <th>Escala</th>
            <th>Horário</th>
            <th>Status</th>
            <th>HE 90d</th>
            <th>WhatsApp</th>
            <th>Ações</th>
          </tr>
        </thead>

        <tbody>

          ${items.map(e => `
            <tr>

              <td>
                ${esc(e.registration)}
              </td>

              <td>
                <strong>
                  ${esc(e.name)}
                </strong>
              </td>

              <td>
                ${esc(e.contract_name || "-")}
              </td>

              <td>
                ${esc(e.post_name || "-")}
              </td>

              <td>
                ${esc(e.role || "-")}
              </td>

              <td>
                ${esc(e.shift || "-")}
              </td>

              <td>
                ${esc(e.schedule || "-")}
              </td>

              <td>
                <span class="badge ${
                  e.active
                    ? "badge-success"
                    : "badge-neutral"
                }">
                  ${e.active ? "Ativo" : "Inativo"}
                </span>
              </td>

              <td>
                ${moneyHours(e.overtime_90d || 0)}
              </td>

              <td>
                ${
                  e.phone
                    ? `
                      <button
                        class="wa-button"
                        onclick="openWhatsApp(
                          '${esc(e.phone)}',
                          'Olá ${esc(e.name)}, tudo bem?'
                        )">
                        WhatsApp
                      </button>
                    `
                    : "-"
                }
              </td>

              <td>
                <button
                  class="btn-secondary btn-small"
                  onclick="editEmployee(${e.id})">
                  ✏️ Editar
                </button>
              </td>

            </tr>
          `).join("")}

        </tbody>

      </table>

    </div>
  `;
}
function editEmployee(id) {
  const employee = cache.employees.find(
    e => Number(e.id) === Number(id)
  );

  if (!employee) {
    notify("Colaborador não encontrado.", "error");
    return;
  }

  showEmployeeForm();

  setTimeout(() => {
    document.getElementById("employeeRegistration").value =
      employee.registration || "";

    document.getElementById("employeeName").value =
      employee.name || "";

    document.getElementById("employeePhone").value =
      employee.phone || "";

    document.getElementById("employeeContract").value =
      employee.contract_id || "";

    updateEmployeePosts();

    document.getElementById("employeePost").value =
      employee.post_id || "";

    document.getElementById("employeeRole").value =
      employee.role || "";

    document.getElementById("employeeShift").value =
      employee.shift || "";

    document.getElementById("employeeSchedule").value =
      employee.schedule || "";

    document.getElementById("employeeActive").checked =
      employee.active !== false;

    document.getElementById("employeeFormTitle").textContent =
      "Editar Colaborador";

    document.getElementById("employeeSubmitButton").textContent =
      "Atualizar Colaborador";

    const form = document.querySelector("#formArea form");

    if (form) {
      form.dataset.employeeId = employee.id;
    }

    document
      .getElementById("formArea")
      .scrollIntoView({
        behavior: "smooth",
        block: "start"
      });

  }, 0);
}

function filterEmployees() {
  const search =
    document.getElementById(
      "employeeSearch"
    ).value.toLowerCase();

  const contract =
    document.getElementById(
      "employeeContractFilter"
    ).value;

  const items =
    cache.employees.filter(e => {
      const matchesSearch =
        e.name
          .toLowerCase()
          .includes(search) ||
        e.registration
          .toLowerCase()
          .includes(search);

      const matchesContract =
        !contract ||
        Number(e.contract_id) ===
          Number(contract);

      return (
        matchesSearch &&
        matchesContract
      );
    });

  document.getElementById(
    "employeeTable"
  ).innerHTML =
    employeeTable(items);
}

function showEmployeeForm() {
  document.getElementById("formArea").innerHTML = `
    <div class="panel form-panel">

      <div class="panel-title">
        <h3 id="employeeFormTitle">Novo Colaborador</h3>

        <button
          onclick="
            document.getElementById('formArea').innerHTML=''
          ">
          ✕
        </button>
      </div>

      <form
        class="form-grid"
        onsubmit="saveEmployee(event)">

        <label>
          Matrícula
          <input
            id="employeeRegistration"
            required>
        </label>

        <label>
          Nome
          <input
            id="employeeName"
            required>
        </label>

        <label>
          WhatsApp
          <input
            id="employeePhone"
            placeholder="62999999999">
        </label>

        <label>
          Contrato
          <select
            id="employeeContract"
            onchange="updateEmployeePosts()">

            <option value="">
              Selecione
            </option>

            ${activeContractsOptions()}

          </select>
        </label>

        <label>
          Posto
          <select id="employeePost">
            <option value="">
              Selecione o contrato
            </option>
          </select>
        </label>

        <label>
          Função
          <input
            id="employeeRole"
            placeholder="Vigilante, ASG...">
        </label>

        <label>
          Escala
          <select id="employeeShift">
            <option value="">
              Selecione
            </option>
            <option value="IMPAR">
              Ímpar
            </option>
            <option value="PAR">
              Par
            </option>
          </select>
        </label>

        <label>
          Horário
          <input
            id="employeeSchedule"
            placeholder="07:00 às 19:00">
        </label>

        <label class="checkbox-label">
          <input
            id="employeeActive"
            type="checkbox"
            checked>
          Colaborador ativo
        </label>

        <div class="form-actions">
          <button
            id="employeeSubmitButton"
            class="primary">
            Salvar Colaborador
          </button>
        </div>

      </form>
    </div>
  `;
}

function updateEmployeePosts() {
  const contractId =
    document.getElementById(
      "employeeContract"
    ).value;

  const posts =
    cache.posts.filter(
      p =>
        Number(p.contract_id) ===
        Number(contractId) &&
        p.active
    );

  document.getElementById(
    "employeePost"
  ).innerHTML = `
    <option value="">
      Sem posto definido
    </option>

    ${posts.map(p => `
      <option value="${p.id}">
        ${esc(p.name)}
      </option>
    `).join("")}
  `;
}

async function saveEmployee(event) {
  event.preventDefault();

  const form = event.target;

  const employeeId =
    form.dataset.employeeId || null;

  const body = {
    registration:
      document.getElementById(
        "employeeRegistration"
      ).value.trim(),

    name:
      document.getElementById(
        "employeeName"
      ).value.trim(),

    phone:
      document.getElementById(
        "employeePhone"
      ).value.trim(),

    contract_id:
      document.getElementById(
        "employeeContract"
      ).value || null,

    post_id:
      document.getElementById(
        "employeePost"
      ).value || null,

    role:
      document.getElementById(
        "employeeRole"
      ).value.trim(),

    shift:
      document.getElementById(
        "employeeShift"
      ).value,

    schedule:
      document.getElementById(
        "employeeSchedule"
      ).value.trim(),

    active:
      document.getElementById(
        "employeeActive"
      ).checked
  };

  try {
    if (employeeId) {

      await api(
        `/api/employees/${employeeId}`,
        {
          method: "PUT",
          body: JSON.stringify(body)
        }
      );

      notify(
        "Colaborador atualizado com sucesso.",
        "success"
      );

    } else {

      await api(
        "/api/employees",
        {
          method: "POST",
          body: JSON.stringify(body)
        }
      );

      notify(
        "Colaborador cadastrado com sucesso.",
        "success"
      );
    }

    cache.employees =
      await api("/api/employees");

    render("colaboradores");

  } catch (error) {
    notify(
      error.message ||
        "Não foi possível salvar o colaborador.",
      "error"
    );
  }
}

function importPage() {
  return `
    <div class="page-header">
      <div>
        <h1>Importar Planilhas</h1>
        <p>Atualize colaboradores e horas extras em lote.</p>
      </div>
    </div>

    <div class="grid-2">
      <div class="panel">
        <div class="panel-title">
          <h3>Colaboradores</h3>
        </div>

        <p class="text-soft">
          Envie uma planilha XLSX, XLS ou CSV. Registros existentes são
          identificados pela matrícula e atualizados sem apagar o histórico.
        </p>

        <input
          id="employeeFile"
          type="file"
          accept=".xlsx,.xls,.csv">

        <div class="form-actions">
          <button class="primary" onclick="importEmployees()">
            Importar colaboradores
          </button>
        </div>

        <div id="employeeImportResult" class="import-result"></div>
      </div>

      <div class="panel">
        <div class="panel-title">
          <h3>Horas extras</h3>
        </div>

        <p class="text-soft">
          Importe os lançamentos de horas extras usando a matrícula para
          relacionar cada registro ao colaborador.
        </p>

        <input
          id="overtimeFile"
          type="file"
          accept=".xlsx,.xls,.csv">

        <div class="form-actions">
          <button class="primary" onclick="importOvertime()">
            Importar horas extras
          </button>
        </div>

        <div id="overtimeImportResult" class="import-result"></div>
      </div>
    </div>
  `;
}

async function importEmployees() {
  const file =
    document.getElementById(
      "employeeFile"
    ).files[0];

  if (!file) {
    return notify(
      "Selecione uma planilha.",
      "error"
    );
  }

  const form = new FormData();
  form.append("file", file);

  try {
    const data =
      await api(
        "/api/import/employees",
        {
          method: "POST",
          body: form
        }
      );

    document.getElementById(
      "employeeImportResult"
    ).innerHTML = `
      <strong>
        ${data.imported}
      </strong>
      colaboradores importados.

      ${
        data.skipped
          ? `<br>${data.skipped} ignorados.`
          : ""
      }

      ${
        data.unknownContracts?.length
          ? `
            <br><br>
            <strong>
              CRs não encontrados:
            </strong>
            ${data.unknownContracts
              .map(esc)
              .join(", ")}
          `
          : ""
      }
    `;

    notify("Importação concluída.");

  } catch (error) {
    notify(error.message, "error");
  }
}

async function importOvertime() {
  const file =
    document.getElementById(
      "overtimeFile"
    ).files[0];

  if (!file) {
    return notify(
      "Selecione uma planilha.",
      "error"
    );
  }

  const form = new FormData();
  form.append("file", file);

  try {
    const data =
      await api(
        "/api/import/overtime",
        {
          method: "POST",
          body: form
        }
      );

    document.getElementById(
      "overtimeImportResult"
    ).innerHTML = `
      <strong>
        ${data.imported}
      </strong>
      registros importados.

      ${
        data.skipped
          ? `<br>${data.skipped} ignorados.`
          : ""
      }
    `;

    notify(
      "Horas extras importadas."
    );

  } catch (error) {
    notify(error.message, "error");
  }
}

/* =========================
   COBERTURAS IA
========================= */

async function coveragesPage() {
  cache.contracts =
    await api("/api/contracts");

  cache.posts =
    await api("/api/posts");

  cache.employees =
    await api("/api/employees");

  cache.coverages =
    await api("/api/coverages");

  return `
    <div class="page-header">
      <div>
        <h1>Coberturas IA</h1>
        <p>
          Localize e priorize colaboradores
          para cobertura de faltas
        </p>
      </div>

      <button
        class="primary"
        onclick="showCoverageForm()">
        + Nova Cobertura
      </button>
    </div>

    <div id="coverageArea"></div>

    <div class="panel">

      <div class="panel-title">
        <h3>
          Histórico de Coberturas
        </h3>

        <span>
          ${cache.coverages.length}
        </span>
      </div>

      ${
        cache.coverages.length
          ? `
            <div class="table-wrap">
              <table class="data-table">

                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Contrato</th>
                    <th>Posto</th>
                    <th>Ausente</th>
                    <th>Escala</th>
                    <th>Cobertura</th>
                    <th>Status</th>
                    <th>Ação</th>
                  </tr>
                </thead>

                <tbody>
                  ${cache.coverages.map(c => `
                    <tr>

                      <td>
                        ${dateBR(
                          c.coverage_date
                        )}
                      </td>

                      <td>
                        ${esc(
                          c.contract_name ||
                          "-"
                        )}
                      </td>

                      <td>
                        ${esc(
                          c.post_name ||
                          "-"
                        )}
                      </td>

                      <td>
                        ${esc(
                          c.absent_name ||
                          "-"
                        )}
                      </td>

                      <td>
                        ${esc(
                          c.shift ||
                          "-"
                        )}
                      </td>

                      <td>
                        ${esc(
                          c.selected_name ||
                          "-"
                        )}
                      </td>

                      <td>
                        ${statusBadge(
                          c.status
                        )}
                      </td>

                      <td>
                        <button
                          class="small-button"
                          onclick="
                            viewCandidates(
                              ${c.id}
                            )
                          ">
                          Candidatos
                        </button>
                      </td>

                    </tr>
                  `).join("")}
                </tbody>

              </table>
            </div>
          `
          : empty(
              "🤖",
              "Nenhuma cobertura",
              "Crie a primeira cobertura para iniciar a priorização."
            )
      }

    </div>
  `;
}

function showCoverageForm() {
  document.getElementById(
    "coverageArea"
  ).innerHTML = `
    <div class="panel form-panel">

      <div class="panel-title">
        <h3>
          Nova Cobertura
        </h3>

        <button
          onclick="
            document.getElementById(
              'coverageArea'
            ).innerHTML=''
          ">
          ✕
        </button>
      </div>

      <form
        class="form-grid"
        onsubmit="
          generateCoverage(event)
        ">

        <label>
          Contrato
          <select
            id="coverageContract"
            required
            onchange="
              updateCoverageDependencies()
            ">

            <option value="">
              Selecione
            </option>

            ${activeContractsOptions()}

          </select>
        </label>

        <label>
          Posto
          <select id="coveragePost">

            <option value="">
              Selecione o contrato
            </option>

          </select>
        </label>

        <label>
          Colaborador ausente
          <select
            id="coverageAbsent"
            onchange="
              updateCoverageShift()
            ">

            <option value="">
              Não informado
            </option>

          </select>
        </label>

        <label>
          Escala do ausente
          <select id="coverageShift">

            <option value="">
              Selecione
            </option>

            <option value="IMPAR">
              Ímpar
            </option>

            <option value="PAR">
              Par
            </option>

          </select>
        </label>

        <label>
          Data da cobertura
          <input
            id="coverageDate"
            type="date"
            required>
        </label>

        <label>
          Motivo
          <input
            id="coverageReason"
            placeholder="
              Falta, atestado, férias...
            ">
        </label>

        <div class="form-actions">
          <button class="primary">
            Gerar candidatos
          </button>
        </div>

      </form>

    </div>
  `;

  document.getElementById(
    "coverageDate"
  ).value =
    new Date()
      .toISOString()
      .slice(0, 10);
}

function updateCoverageDependencies() {
  const contractId =
    Number(
      document.getElementById(
        "coverageContract"
      ).value
    );

  const posts =
    cache.posts.filter(
      p =>
        Number(p.contract_id) ===
        contractId &&
        p.active
    );

  const employees =
    cache.employees.filter(
      e =>
        Number(e.contract_id) ===
        contractId &&
        e.active
    );

  document.getElementById(
    "coveragePost"
  ).innerHTML = `
    <option value="">
      Sem posto definido
    </option>

    ${posts.map(p => `
      <option value="${p.id}">
        ${esc(p.name)}
      </option>
    `).join("")}
  `;

  document.getElementById(
    "coverageAbsent"
  ).innerHTML = `
    <option value="">
      Não informado
    </option>

    ${employees.map(e => `
      <option value="${e.id}">
        ${esc(e.name)}
        - ${esc(e.registration)}
      </option>
    `).join("")}
  `;
}

function updateCoverageShift() {
  const employeeId =
    Number(
      document.getElementById(
        "coverageAbsent"
      ).value
    );

  const employee =
    cache.employees.find(
      e => e.id === employeeId
    );

  if (employee?.shift) {
    document.getElementById(
      "coverageShift"
    ).value =
      employee.shift;
  }
}

async function generateCoverage(event) {
  event.preventDefault();

  try {
    const data =
      await api(
        "/api/coverages",
        {
          method: "POST",
          body: JSON.stringify({
            contract_id:
              document.getElementById(
                "coverageContract"
              ).value,

            post_id:
              document.getElementById(
                "coveragePost"
              ).value || null,

            absent_employee_id:
              document.getElementById(
                "coverageAbsent"
              ).value || null,

            shift:
              document.getElementById(
                "coverageShift"
              ).value,

            coverage_date:
              document.getElementById(
                "coverageDate"
              ).value,

            reason:
              document.getElementById(
                "coverageReason"
              ).value
          })
        }
      );

    notify(
      `${data.candidates.length} candidatos encontrados.`
    );

    showCoverageCandidates(
      data.coverage,
      data.candidates
    );

  } catch (error) {
    notify(
      error.message,
      "error"
    );
  }
}

function showCoverageCandidates(
  coverage,
  candidates
) {
  activeCoverageSession = {
    coverage,
    candidates,
    batchIds: []
  };

  const pendingCandidates =
    candidates.filter(candidate =>
      candidate.phone &&
      (!candidate.status ||
        candidate.status === "PENDENTE")
    );

  const nextBatch = pendingCandidates.slice(0, 5);
  activeCoverageSession.batchIds = nextBatch.map(
    candidate => Number(candidate.id)
  );
  const contactedCount = candidates.filter(
    candidate =>
      candidate.status === "MENSAGEM_ENVIADA" ||
      candidate.status === "CONFIRMADO"
  ).length;

  document.getElementById(
    "coverageArea"
  ).innerHTML = `
    <div class="panel">

      <div class="panel-title">
        <div>
          <h3>
            Ranking de candidatos
          </h3>

          <p class="muted">
            Priorização automática do
            OPERA IA
          </p>
        </div>

        <span>
          ${candidates.length}
          encontrados
        </span>
      </div>

      ${
        coverage.status !== "CONFIRMADA" && nextBatch.length
          ? `
            <div class="coverage-batch-panel">
              <div>
                <strong>
                  Lote ${Math.floor(contactedCount / 5) + 1}
                </strong>
                <p>
                  ${nextBatch.length} candidato(s) selecionado(s) pela IA.
                  As conversas serão abertas com a mensagem pronta.
                </p>
              </div>

              <div class="coverage-batch-list">
                ${nextBatch.map((candidate, index) => `
                  <button
                    id="batchCandidate-${candidate.id}"
                    class="wa-button"
                    onclick="openCoverageBatchCandidate(${candidate.id})">
                    ${index + 1}. ${esc(candidate.name)}
                  </button>
                `).join("")}
              </div>
            </div>
          `
          : coverage.status === "CONFIRMADA"
            ? `
              <div class="message success">
                Cobertura confirmada. Novos lotes estão bloqueados.
              </div>
            `
            : `
              <div class="message">
                Todos os candidatos com WhatsApp já foram contatados.
              </div>
            `
      }

      ${
        candidates.length
          ? `
            <div class="candidate-list">

              ${candidates.map(
                (e, index) => `
                <div
                  class="candidate-card">

                  <div
                    class="candidate-position">
                    ${index + 1}
                  </div>

                  <div
                    class="candidate-info">

                    <strong>
                      ${esc(e.name)}
                    </strong>

                    <span>
                      ${esc(
                        e.registration
                      )}
                      •
                      ${esc(
                        e.role || "-"
                      )}
                    </span>

                    <small>
                      ${
                        Number(
                          e.contract_id
                        ) ===
                        Number(
                          coverage.contract_id
                        )
                          ? "Mesmo contrato"
                          : "Outro contrato"
                      }
                      •
                      Escala:
                      ${esc(
                        e.shift || "-"
                      )}
                      •
                      HE 90d:
                      ${moneyHours(
                        e.overtime_90d
                      )}h
                      •
                      ${esc(
                        e.status || "PENDENTE"
                      )}
                    </small>

                  </div>

                  <div
                    class="candidate-score">
                    ${Number(
                      e.score
                    ).toFixed(0)}
                    pts
                  </div>

                  <div
                    class="candidate-actions">

                    ${
                      e.phone
                        ? `
                          <button
                            class="wa-button"
                            onclick="
                              contactCoverage(
                                ${coverage.id},
                                ${e.id},
                                '${esc(
                                  e.phone
                                )}',
                                '${esc(
                                  e.name
                                )}'
                              )
                            ">
                            WhatsApp
                          </button>
                        `
                        : `
                          <span
                            class="muted">
                            Sem telefone
                          </span>
                        `
                    }

                    <button
                      class="primary"
                      onclick="
                        confirmCoverage(
                          ${coverage.id},
                          ${e.id},
                          '${esc(
                            e.name
                          )}'
                        )
                      ">
                      Confirmar
                    </button>

                  </div>

                </div>
              `).join("")}

            </div>
          `
          : empty(
              "🔎",
              "Nenhum candidato encontrado",
              "Verifique escala e colaboradores cadastrados."
            )
      }

    </div>
  `;
}

function buildCoverageMessage(coverage, name) {
  const contract =
    coverage.contract_name ||
    cache.contracts.find(
      item =>
        Number(item.id) ===
        Number(coverage.contract_id)
    )?.name;

  return (
    `Olá ${name}, tudo bem? ` +
    `Temos uma oportunidade de cobertura extra` +
    `${contract ? ` no contrato ${contract}` : ""}` +
    `${
      coverage.coverage_date
        ? ` para o dia ${dateBR(coverage.coverage_date)}`
        : ""
    }. Você possui disponibilidade?`
  );
}

function whatsappUrl(phone, message) {
  let normalized = String(phone || "").replace(/\D/g, "");

  if (normalized && normalized.length <= 11) {
    normalized = `55${normalized}`;
  }

  return (
    `https://wa.me/${normalized}` +
    `?text=${encodeURIComponent(message)}`
  );
}

async function openCoverageBatchCandidate(employeeId) {
  if (!activeCoverageSession) return;

  const { coverage, candidates, batchIds } = activeCoverageSession;
  const candidate = candidates.find(
    item => Number(item.id) === Number(employeeId)
  );

  if (
    !candidate ||
    !candidate.phone ||
    (candidate.status && candidate.status !== "PENDENTE")
  ) {
    notify("Este candidato já foi contatado.", "error");
    return;
  }

  const popup = window.open(
    whatsappUrl(
      candidate.phone,
      buildCoverageMessage(coverage, candidate.name)
    ),
    "_blank"
  );

  if (!popup) {
    notify(
      "O navegador bloqueou o WhatsApp. Permita pop-ups para o OPERA IA e tente novamente.",
      "error"
    );
    return;
  }

  popup.opener = null;

  try {
    await api(
      `/api/coverages/${coverage.id}/contact/${candidate.id}`,
      { method: "POST" }
    );

    candidate.status = "MENSAGEM_ENVIADA";

    const button = document.getElementById(
      `batchCandidate-${candidate.id}`
    );

    if (button) {
      button.disabled = true;
      button.textContent = `✓ ${candidate.name}`;
    }

    const batchFinished = batchIds.every(id => {
      const item = candidates.find(
        current => Number(current.id) === Number(id)
      );

      return item?.status === "MENSAGEM_ENVIADA" ||
        item?.status === "CONFIRMADO";
    });

    if (batchFinished) {
      showCoverageCandidates(coverage, candidates);
      notify("Lote concluído. O próximo grupo já está disponível.");
    }
  } catch (error) {
    notify(error.message, "error");
  }
}

async function viewCandidates(
  coverageId
) {
  try {
    const candidates =
      await api(
        `/api/coverages/${coverageId}/candidates`
      );

    const coverage =
      cache.coverages.find(
        c => c.id === coverageId
      ) || {
        id: coverageId
      };

    showCoverageCandidates(
      coverage,
      candidates
    );

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });

  } catch (error) {
    notify(
      error.message,
      "error"
    );
  }
}

async function contactCoverage(
  coverageId,
  employeeId,
  phone,
  name
) {
  try {
    const coverage =
      cache.coverages.find(
        c => c.id === coverageId
      );

    const message = buildCoverageMessage(
      coverage || { id: coverageId },
      name
    );

    await api(
      `/api/coverages/${coverageId}/contact/${employeeId}`,
      { method: "POST" }
    );

    await openWhatsApp(
      phone,
      message
    );

  } catch (error) {
    notify(
      error.message,
      "error"
    );
  }
}

async function confirmCoverage(
  coverageId,
  employeeId,
  employeeName
) {
  if (
    !confirm(
      `Confirmar ${employeeName} para esta cobertura?`
    )
  ) {
    return;
  }

  try {
    await api(
      `/api/coverages/${coverageId}/confirm/${employeeId}`,
      { method: "POST" }
    );

    notify(
      "Cobertura confirmada."
    );

    render("coberturas");

  } catch (error) {
    notify(
      error.message,
      "error"
    );
  }
}

/* =========================
   HORAS EXTRAS
========================= */

async function overtimePage() {
  cache.employees =
    await api("/api/employees");

  const overtime =
    await api("/api/overtime");

  return `
    <div class="page-header">

      <div>
        <h1>Horas Extras</h1>
        <p>
          Histórico de extras
          por colaborador
        </p>
      </div>

      <button
        class="primary"
        onclick="
          showOvertimeForm()
        ">
        + Registrar HE
      </button>

    </div>

    <div id="formArea"></div>

    <div class="panel">

      ${
        overtime.length
          ? `
            <div class="table-wrap">

              <table
                class="data-table">

                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Matrícula</th>
                    <th>Colaborador</th>
                    <th>Contrato</th>
                    <th>Horas</th>
                    <th>Descrição</th>
                  </tr>
                </thead>

                <tbody>

                  ${overtime.map(o => `
                    <tr>

                      <td>
                        ${dateBR(
                          o.work_date
                        )}
                      </td>

                      <td>
                        ${esc(
                          o.registration
                        )}
                      </td>

                      <td>
                        <strong>
                          ${esc(
                            o.employee_name
                          )}
                        </strong>
                      </td>

                      <td>
                        ${esc(
                          o.contract_name ||
                          "-"
                        )}
                      </td>

                      <td>
                        ${moneyHours(
                          o.hours
                        )}h
                      </td>

                      <td>
                        ${esc(
                          o.description ||
                          "-"
                        )}
                      </td>

                    </tr>
                  `).join("")}

                </tbody>

              </table>

            </div>
          `
          : empty(
              "⏱️",
              "Nenhuma hora extra",
              "Registre manualmente ou importe uma planilha."
            )
      }

    </div>
  `;
}

function showOvertimeForm() {
  document.getElementById(
    "formArea"
  ).innerHTML = `
    <div class="panel form-panel">

      <div class="panel-title">
        <h3>
          Registrar Hora Extra
        </h3>
      </div>

      <form
        class="form-grid"
        onsubmit="
          saveOvertime(event)
        ">

        <label>
          Colaborador
          <select
            id="overtimeEmployee"
            required>

            <option value="">
              Selecione
            </option>

            ${cache.employees
              .filter(e => e.active)
              .map(e => `
                <option value="${e.id}">
                  ${esc(e.name)}
                  -
                  ${esc(e.registration)}
                </option>
              `)
              .join("")}

          </select>
        </label>

        <label>
          Data
          <input
            id="overtimeDate"
            type="date"
            required>
        </label>

        <label>
          Quantidade de horas
          <input
            id="overtimeHours"
            type="number"
            step="0.01"
            min="0"
            required>
        </label>

        <label>
          Descrição
          <input
            id="overtimeDescription"
            placeholder="
              Cobertura, dobra...
            ">
        </label>

        <div class="form-actions">
          <button class="primary">
            Salvar
          </button>
        </div>

      </form>

    </div>
  `;

  document.getElementById(
    "overtimeDate"
  ).value =
    new Date()
      .toISOString()
      .slice(0, 10);
}

async function saveOvertime(event) {
  event.preventDefault();

  try {
    await api("/api/overtime", {
      method: "POST",
      body: JSON.stringify({
        employee_id:
          document.getElementById(
            "overtimeEmployee"
          ).value,

        work_date:
          document.getElementById(
            "overtimeDate"
          ).value,

        hours:
          document.getElementById(
            "overtimeHours"
          ).value,

        description:
          document.getElementById(
            "overtimeDescription"
          ).value
      })
    });

    notify(
      "Hora extra registrada."
    );

    render("extras");

  } catch (error) {
    notify(
      error.message,
      "error"
    );
  }
}

/* =========================
   FOLHA / TREINAMENTO
========================= */

async function requestPage(type) {
  cache.contracts =
    await api("/api/contracts");

  cache.employees =
    await api("/api/employees");

  const allRequests =
    await api("/api/requests");

  const items =
    allRequests.filter(
      r => r.type === type
    );

  const isPoint =
    type === "FOLHA_PONTO";

  const title =
    isPoint
      ? "Folha de Ponto"
      : "Treinamentos GPS VC";

  const icon =
    isPoint ? "📄" : "🎓";

  return `
    <div class="page-header">

      <div>
        <h1>
          ${title}
        </h1>

        <p>
          ${
            isPoint
              ? "Solicitação de assinatura aos colaboradores"
              : "Controle de treinamentos pendentes"
          }
        </p>
      </div>

      <button
        class="primary"
        onclick="
          showRequestForm(
            '${type}'
          )
        ">
        + Nova Solicitação
      </button>

    </div>

    <div id="requestArea"></div>

    <div class="panel">

      ${
        items.length
          ? requestTable(items)
          : empty(
              icon,
              "Nenhuma solicitação",
              "Crie uma solicitação para os colaboradores."
            )
      }

    </div>
  `;
}

function showRequestForm(type) {
  const isPoint =
    type === "FOLHA_PONTO";

  document.getElementById(
    "requestArea"
  ).innerHTML = `
    <div class="panel form-panel">

      <div class="panel-title">
        <h3>
          Nova Solicitação
        </h3>
      </div>

      <div class="form-grid">

        <label>
          Contrato
          <select
            id="requestContract"
            onchange="
              updateRequestEmployees()
            ">

            <option value="">
              Selecione um contrato
            </option>

            ${activeContractsOptions()}

          </select>
        </label>

        <label>
          ${
            isPoint
              ? "Mês de referência"
              : "Referência"
          }

          <input
            id="requestReference"
            ${
              isPoint
                ? 'type="month"'
                : ""
            }
            placeholder="
              Ex.: Treinamentos pendentes
            ">
        </label>

        <label class="full">
          Mensagem

          <textarea
            id="requestMessage"
            rows="3">${
              isPoint
                ? "você tem uma folha de ponto pendente de assinatura no aplicativo GPS VC. Favor realizar com a maior brevidade."
                : "você tem treinamentos pendentes no seu aplicativo GPS VC. Favor realizar com a maior brevidade."
            }</textarea>
        </label>

      </div>

      <div class="selection-header">

        <strong>
          Colaboradores
        </strong>

        <label
          class="inline-check">

          <input
            type="checkbox"
            id="selectAllEmployees"
            onchange="
              toggleAllRequestEmployees()
            ">

          Selecionar todos

        </label>

      </div>

      <div
        id="requestEmployees"
        class="employee-selection">
      </div>

      <div class="form-actions">

        <button
          class="primary"
          onclick="
            createRequests(
              '${type}'
            )
          ">
          Criar e preparar mensagens
        </button>

      </div>

    </div>
  `;

  updateRequestEmployees();
}

function updateRequestEmployees() {
  const contractId =
    document.getElementById(
      "requestContract"
    )?.value || "";

  const employees = contractId
    ? cache.employees.filter(
        e =>
          e.active &&
          Number(e.contract_id) ===
            Number(contractId)
      )
    : [];

  const selectAll = document.getElementById(
    "selectAllEmployees"
  );

  if (selectAll) selectAll.checked = false;

  document.getElementById(
    "requestEmployees"
  ).innerHTML =
    employees.length
      ? employees.map(e => `
          <label
            class="employee-check">

            <input
              type="checkbox"
              class="requestEmployee"
              value="${e.id}">

            <span>
              <strong>
                ${esc(e.name)}
              </strong>

              <small>
                ${esc(e.registration)}
                •
                ${esc(
                  e.contract_name ||
                  "-"
                )}
              </small>
            </span>

          </label>
        `).join("")
      : `
          <p class="muted">
            ${
              contractId
                ? "Nenhum colaborador ativo neste contrato."
                : "Selecione um contrato para exibir os colaboradores."
            }
          </p>
        `;
}

function toggleAllRequestEmployees() {
  const checked =
    document.getElementById(
      "selectAllEmployees"
    ).checked;

  document
    .querySelectorAll(
      ".requestEmployee"
    )
    .forEach(
      input =>
        input.checked = checked
    );
}

async function createRequests(type) {
  const contractId =
    document.getElementById(
      "requestContract"
    ).value;

  if (!contractId) {
    return notify(
      "Selecione um contrato.",
      "error"
    );
  }

  const employeeIds =
    Array.from(
      document.querySelectorAll(
        ".requestEmployee:checked"
      )
    ).map(
      input =>
        Number(input.value)
    );

  if (!employeeIds.length) {
    return notify(
      "Selecione pelo menos um colaborador.",
      "error"
    );
  }

  const reference =
    document.getElementById(
      "requestReference"
    ).value;

  const baseMessage =
    document.getElementById(
      "requestMessage"
    ).value.trim();

  if (!baseMessage) {
    return notify(
      "Informe a mensagem.",
      "error"
    );
  }

  try {
    const queue = [];

    /*
      Criação individual para permitir
      mensagem personalizada com o nome.
    */
    for (const employeeId of employeeIds) {
      const employee =
        cache.employees.find(
          e => e.id === employeeId
        );

      let message =
        `${employee.name}, ${baseMessage}`;

      if (
        type === "FOLHA_PONTO" &&
        reference
      ) {
        const [year, month] =
          reference.split("-");

        message =
          `${employee.name}, você tem uma folha de ponto referente ao mês ` +
          `${month}/${year} pendente de assinatura no aplicativo GPS VC. ` +
          "Favor realizar com a maior brevidade.";
      }

      const result = await api(
        "/api/requests",
        {
          method: "POST",
          body: JSON.stringify({
            employee_ids: [
              employeeId
            ],
            type,
            reference,
            message
          })
        }
      );

      const created = result.items?.[0];

      if (created) {
        queue.push({
          requestId: created.id,
          employeeId,
          name: employee.name,
          phone: employee.phone,
          message,
          sent: false
        });
      }
    }

    activeRequestSendQueue = queue;

    notify(
      `${employeeIds.length} solicitações criadas. Abra cada mensagem abaixo.`
    );

    showRequestSendQueue(type);

  } catch (error) {
    notify(
      error.message,
      "error"
    );
  }
}

function showRequestSendQueue(type) {
  const area = document.getElementById("requestArea");

  if (!area) return;

  area.innerHTML = `
    <div class="panel request-send-panel">
      <div>
        <h3>Mensagens prontas</h3>
        <p>
          Toque em cada colaborador, confira a mensagem no WhatsApp
          e confirme o envio. O sistema não envia sem sua confirmação.
        </p>
      </div>

      <div class="request-send-list">
        ${activeRequestSendQueue.map((item, index) => `
          <button
            id="requestSend-${index}"
            class="wa-button"
            ${item.phone ? "" : "disabled"}
            onclick="openPreparedRequestMessage(${index}, '${type}')">
            ${item.phone
              ? `Abrir WhatsApp — ${esc(item.name)}`
              : `Sem telefone — ${esc(item.name)}`}
          </button>
        `).join("")}
      </div>
    </div>
  `;

  area.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function openPreparedRequestMessage(index, type) {
  const item = activeRequestSendQueue[index];

  if (!item || item.sent || !item.phone) return;

  const popup = window.open(
    whatsappUrl(item.phone, item.message),
    "_blank"
  );

  if (!popup) {
    notify(
      "O navegador bloqueou o WhatsApp. Permita pop-ups e tente novamente.",
      "error"
    );
    return;
  }

  popup.opener = null;

  try {
    await api(
      `/api/requests/${item.requestId}/status`,
      {
        method: "PUT",
        body: JSON.stringify({
          status: "MENSAGEM_ENVIADA"
        })
      }
    );

    item.sent = true;

    const button = document.getElementById(
      `requestSend-${index}`
    );

    if (button) {
      button.disabled = true;
      button.textContent = `✓ Aberta — ${item.name}`;
    }

    const remaining = activeRequestSendQueue.filter(
      current => current.phone && !current.sent
    ).length;

    notify(
      remaining
        ? `Mensagem aberta. Restam ${remaining}.`
        : "Todas as mensagens foram abertas."
    );
  } catch (error) {
    notify(error.message, "error");
  }
}

function requestTable(items) {
  return `
    <div class="table-wrap">

      <table class="data-table">

        <thead>
          <tr>
            <th>Colaborador</th>
            <th>Contrato</th>
            <th>Referência</th>
            <th>Status</th>
            <th>WhatsApp</th>
            <th>Concluir</th>
          </tr>
        </thead>

        <tbody>

          ${items.map(r => `
            <tr>

              <td>
                <strong>
                  ${esc(
                    r.employee_name
                  )}
                </strong>

                <br>

                <small>
                  ${esc(
                    r.registration
                  )}
                </small>
              </td>

              <td>
                ${esc(
                  r.contract_name ||
                  "-"
                )}
              </td>

              <td>
                ${esc(
                  r.reference ||
                  "-"
                )}
              </td>

              <td>
                ${statusBadge(
                  r.status
                )}
              </td>

              <td>
                ${
                  r.phone
                    ? `
                      <button
                        class="wa-button"
                        onclick="
                          sendRequestWhatsApp(
                            ${r.id},
                            '${esc(
                              r.phone
                            )}',
                            '${encodeURIComponent(
                              r.message || ""
                            )}'
                          )
                        ">
                        Enviar
                      </button>
                    `
                    : "-"
                }
              </td>

              <td>
                ${
                  ![
                    "ASSINADO",
                    "CONCLUIDO"
                  ].includes(
                    r.status
                  )
                    ? `
                      <button
                        class="small-button"
                        onclick="
                          completeRequest(
                            ${r.id},
                            '${r.type}'
                          )
                        ">
                        Concluir
                      </button>
                    `
                    : "✓"
                }
              </td>

            </tr>
          `).join("")}

        </tbody>

      </table>

    </div>
  `;
}

async function sendRequestWhatsApp(
  requestId,
  phone,
  encodedMessage
) {
  try {
    const message =
      decodeURIComponent(
        encodedMessage
      );

    await openWhatsApp(
      phone,
      message
    );

    await api(
      `/api/requests/${requestId}/status`,
      {
        method: "PUT",
        body: JSON.stringify({
          status:
            "MENSAGEM_ENVIADA"
        })
      }
    );

    notify(
      "Mensagem preparada no WhatsApp."
    );

  } catch (error) {
    notify(
      error.message,
      "error"
    );
  }
}

async function completeRequest(
  id,
  type
) {
  const status =
    type === "FOLHA_PONTO"
      ? "ASSINADO"
      : "CONCLUIDO";

  try {
    await api(
      `/api/requests/${id}/status`,
      {
        method: "PUT",
        body: JSON.stringify({
          status
        })
      }
    );

    notify(
      "Pendência concluída."
    );

    render(
      type === "FOLHA_PONTO"
        ? "ponto"
        : "treinamentos"
    );

  } catch (error) {
    notify(
      error.message,
      "error"
    );
  }
}

/* =========================
   CENTRAL DE PENDÊNCIAS
========================= */

async function pendingPage() {
  cache.requests =
    await api("/api/requests");

  const pending =
    cache.requests.filter(
      r =>
        ![
          "ASSINADO",
          "CONCLUIDO",
          "CANCELADO"
        ].includes(r.status)
    );

  const point =
    pending.filter(
      r =>
        r.type ===
        "FOLHA_PONTO"
    ).length;

  const training =
    pending.filter(
      r =>
        r.type ===
        "TREINAMENTO"
    ).length;

  const others =
    pending.length -
    point -
    training;

  return `
    <div class="page-header">

      <div>
        <h1>
          Central de Pendências
        </h1>

        <p>
          Tudo que precisa de
          acompanhamento
        </p>
      </div>

    </div>

    <div class="cards">

      ${card(
        "Folhas de Ponto",
        point,
        "Pendentes"
      )}

      ${card(
        "Treinamentos",
        training,
        "Pendentes"
      )}

      ${card(
        "Outras solicitações",
        others,
        "Pendentes"
      )}

      ${card(
        "Total",
        pending.length,
        "Aguardando ação"
      )}

    </div>

    <div class="panel">

      <div class="panel-title">

        <h3>
          Pendências abertas
        </h3>

        ${
          pending.length
            ? `
              <button
                class="primary"
                onclick="
                  sendAllPending()
                ">
                Enviar para todos
              </button>
            `
            : ""
        }

      </div>

      ${
        pending.length
          ? requestTable(pending)
          : empty(
              "✅",
              "Nenhuma pendência",
              "Todas as solicitações estão em dia."
            )
      }

    </div>
  `;
}

async function sendAllPending() {
  const pending =
    cache.requests.filter(
      r =>
        r.status ===
          "PENDENTE" &&
        r.phone &&
        r.message
    );

  if (!pending.length) {
    return notify(
      "Não há mensagens pendentes com WhatsApp.",
      "error"
    );
  }

  /*
    Navegadores bloqueiam múltiplas
    abas automáticas. Abrimos a primeira
    e marcamos somente ela como enviada.
    A extensão futura poderá executar
    lotes de 5.
  */
  const first =
    pending[0];

  await sendRequestWhatsApp(
    first.id,
    first.phone,
    encodeURIComponent(
      first.message
    )
  );

  notify(
    `1 de ${pending.length} mensagens aberta. Para disparos em lote usaremos a extensão OPERA IA.`
  );
}

/* =========================
   RELATÓRIOS
========================= */

async function reportsPage() {
  const overtime =
    await api(
      "/api/reports/overtime"
    );

  const contracts =
    await api(
      "/api/reports/contracts"
    );

  return `
    <div class="page-header">

      <div>
        <h1>Relatórios</h1>
        <p>
          Indicadores operacionais
          do OPERA IA
        </p>
      </div>

    </div>

    <div class="report-grid">

      <div class="panel">

        <div class="panel-title">
          <h3>
            Horas Extras por Colaborador
          </h3>
        </div>

        ${
          overtime.length
            ? `
              <div class="table-wrap">

                <table
                  class="data-table">

                  <thead>
                    <tr>
                      <th>Matrícula</th>
                      <th>Colaborador</th>
                      <th>Contrato</th>
                      <th>Registros</th>
                      <th>Total HE</th>
                    </tr>
                  </thead>

                  <tbody>

                    ${overtime.map(e => `
                      <tr>

                        <td>
                          ${esc(
                            e.registration
                          )}
                        </td>

                        <td>
                          ${esc(
                            e.name
                          )}
                        </td>

                        <td>
                          ${esc(
                            e.contract_name ||
                            "-"
                          )}
                        </td>

                        <td>
                          ${e.records}
                        </td>

                        <td>
                          <strong>
                            ${moneyHours(
                              e.total_hours
                            )}h
                          </strong>
                        </td>

                      </tr>
                    `).join("")}

                  </tbody>

                </table>

              </div>
            `
            : empty(
                "📈",
                "Sem dados",
                "Importe horas extras."
              )
        }

      </div>

      <div class="panel">

        <div class="panel-title">
          <h3>
            Resumo por Contrato
          </h3>
        </div>

        ${
          contracts.length
            ? `
              <div class="table-wrap">

                <table
                  class="data-table">

                  <thead>
                    <tr>
                      <th>CR</th>
                      <th>Contrato</th>
                      <th>Postos</th>
                      <th>Colaboradores</th>
                      <th>HE</th>
                    </tr>
                  </thead>

                  <tbody>

                    ${contracts.map(c => `
                      <tr>

                        <td>
                          ${esc(c.cr)}
                        </td>

                        <td>
                          ${esc(c.name)}
                        </td>

                        <td>
                          ${c.posts}
                        </td>

                        <td>
                          ${c.employees}
                        </td>

                        <td>
                          ${moneyHours(
                            c.overtime_hours
                          )}h
                        </td>

                      </tr>
                    `).join("")}

                  </tbody>

                </table>

              </div>
            `
            : empty(
                "🏢",
                "Sem contratos",
                "Cadastre seus contratos."
              )
        }

      </div>

    </div>
  `;
}

/* =========================
   ADMINISTRAÇÃO
========================= */

async function adminPage() {
  if (
    currentUser?.role !== "ADM"
  ) {
    return `
      <div class="page-header">
        <div>
          <h1>Administração</h1>
        </div>
      </div>

      <div class="panel">
        ${empty(
          "🔒",
          "Acesso restrito",
          "Somente o administrador possui acesso."
        )}
      </div>
    `;
  }

  const users =
    await api("/api/users");

  return `
    <div class="page-header">

      <div>
        <h1>Administração</h1>

        <p>
          Usuários e níveis de acesso
        </p>
      </div>

      <button
        class="primary"
        onclick="
          showUserForm()
        ">
        + Novo Usuário
      </button>

    </div>

    <div id="userArea"></div>

    <div class="panel">

      ${
        users.length
          ? `
            <div class="table-wrap">

              <table
                class="data-table">

                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>E-mail</th>
                    <th>Perfil</th>
                    <th>Status</th>
                  </tr>
                </thead>

                <tbody>

                  ${users.map(u => `
                    <tr>

                      <td>
                        <strong>
                          ${esc(u.name)}
                        </strong>
                      </td>

                      <td>
                        ${esc(u.email)}
                      </td>

                      <td>
                        ${statusBadge(
                          u.role
                        )}
                      </td>

                      <td>
                        ${statusBadge(
                          u.active
                            ? "ATIVO"
                            : "INATIVO"
                        )}
                      </td>

                    </tr>
                  `).join("")}

                </tbody>

              </table>

            </div>
          `
          : empty(
              "👤",
              "Nenhum usuário",
              ""
            )
      }

    </div>
  `;
}

function showUserForm() {
  document.getElementById(
    "userArea"
  ).innerHTML = `
    <div class="panel form-panel">

      <div class="panel-title">
        <h3>
          Novo Usuário
        </h3>
      </div>

      <form
        class="form-grid"
        onsubmit="
          saveUser(event)
        ">

        <label>
          Nome
          <input
            id="userName"
            required>
        </label>

        <label>
          E-mail
          <input
            id="userEmail"
            type="email"
            required>
        </label>

        <label>
          Senha inicial
          <input
            id="userPassword"
            type="password"
            minlength="8"
            required>
        </label>

        <label>
          Perfil
          <select
            id="userRole"
            required>

            <option value="SUPERVISOR">
              Supervisor
            </option>

            <option value="COORDENADOR">
              Coordenador
            </option>

            <option value="ADM">
              Administrador
            </option>

          </select>
        </label>

        <div class="form-actions">
          <button class="primary">
            Criar Usuário
          </button>
        </div>

      </form>

    </div>
  `;
}

async function saveUser(event) {
  event.preventDefault();

  try {
    await api("/api/users", {
      method: "POST",
      body: JSON.stringify({
        name:
          document.getElementById(
            "userName"
          ).value,

        email:
          document.getElementById(
            "userEmail"
          ).value,

        password:
          document.getElementById(
            "userPassword"
          ).value,

        role:
          document.getElementById(
            "userRole"
          ).value
      })
    });

    notify(
      "Usuário criado."
    );

    render("administracao");

  } catch (error) {
    notify(
      error.message,
      "error"
    );
  }
}

/* =========================
   WHATSAPP
========================= */

async function openWhatsApp(
  phone,
  message
) {
  try {
    const data =
      await api(
        "/api/whatsapp/message",
        {
          method: "POST",
          body: JSON.stringify({
            phone,
            message
          })
        }
      );

    window.open(
      data.url,
      "_blank"
    );

  } catch (error) {
    notify(
      error.message,
      "error"
    );
  }
}

/* =========================
   HELPERS
========================= */

function activeContractsOptions() {
  return cache.contracts
    .filter(c => c.active)
    .map(c => `
      <option value="${c.id}">
        ${esc(c.cr)}
        -
        ${esc(c.name)}
      </option>
    `)
    .join("");
}

function statusBadge(status = "") {
  const value =
    String(status)
      .toUpperCase();

  let css = "neutral-badge";

  if (
    [
      "ATIVO",
      "CONFIRMADA",
      "ASSINADO",
      "CONCLUIDO",
      "CONFIRMADO"
    ].includes(value)
  ) {
    css = "active-badge";
  }

  if (
    [
      "PENDENTE",
      "ABERTA",
      "MENSAGEM_ENVIADA"
    ].includes(value)
  ) {
    css = "warning-badge";
  }

  if (
    [
      "INATIVO",
      "CANCELADO"
    ].includes(value)
  ) {
    css = "inactive-badge";
  }

  return `
    <span
      class="badge ${css}">
      ${esc(
        value.replaceAll("_", " ")
      )}
    </span>
  `;
}

function empty(
  icon,
  title,
  text
) {
  return `
    <div class="empty">

      <div class="empty-icon">
        ${icon}
      </div>

      <h3>
        ${esc(title)}
      </h3>

      ${
        text
          ? `<p>${esc(text)}</p>`
          : ""
      }

    </div>
  `;
}

/* =========================
   INICIALIZAÇÃO
========================= */

async function start() {
  try {
    const setup =
      await api(
        "/api/setup-status"
      );

    if (setup.needsSetup) {
      setupScreen();
      return;
    }

    if (!token) {
      loginScreen();
      return;
    }

    try {
      currentUser =
        await api("/api/me");

      localStorage.setItem(
        "opera_user",
        JSON.stringify(
          currentUser
        )
      );

      render("dashboard");

    } catch {
      logout();
    }

  } catch (error) {
    app.innerHTML = `
      <div class="auth-page">

        <div class="auth-card">

          <div
            class="auth-logo">
            O
          </div>

          <h1>OPERA IA</h1>

          <div
            class="auth-divider">
          </div>

          <h2>
            Sistema indisponível
          </h2>

          <p>
            ${esc(
              error.message
            )}
          </p>

        </div>

      </div>
    `;
  }
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/service-worker.js")
      .catch(error => console.error(
        "Falha ao registrar o service worker:",
        error
      ));
  });
}

start();

const app = document.getElementById("app");

let token = localStorage.getItem("opera_token") || "";
let currentUser = JSON.parse(localStorage.getItem("opera_user") || "null");
let currentPage = "dashboard";

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

async function api(url, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({}));

  if (response.status === 401 && token) {
    logout();
    throw new Error("Sua sessão expirou.");
  }

  if (!response.ok) {
    throw new Error(data.error || "Erro ao processar solicitação.");
  }

  return data;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

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
    "Crie a conta do administrador principal do sistema.",
    `
      <label>
        Nome
        <input
          id="name"
          type="text"
          placeholder="Nome do administrador"
          required>
      </label>

      <label>
        E-mail
        <input
          id="email"
          type="email"
          placeholder="seu@email.com"
          required>
      </label>

      <label>
        Senha
        <input
          id="password"
          type="password"
          placeholder="Mínimo de 8 caracteres"
          minlength="8"
          required>
      </label>

      <label>
        Confirmar senha
        <input
          id="confirmPassword"
          type="password"
          placeholder="Digite novamente"
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

  const name =
    document.getElementById("name").value.trim();

  const email =
    document.getElementById("email").value.trim();

  const password =
    document.getElementById("password").value;

  const confirmPassword =
    document.getElementById("confirmPassword").value;

  if (password !== confirmPassword) {
    message.textContent =
      "As senhas não coincidem.";

    message.className =
      "auth-message error";

    return;
  }

  try {
    message.textContent =
      "Criando administrador...";

    message.className =
      "auth-message";

    await api("/api/setup", {
      method: "POST",
      body: JSON.stringify({
        name,
        email,
        password
      })
    });

    loginScreen(
      "Administrador criado com sucesso. Faça seu login."
    );

  } catch (error) {
    message.textContent = error.message;
    message.className =
      "auth-message error";
  }
}

function loginScreen(successMessage = "") {
  authScreen(
    "Acessar sistema",
    "Entre com suas credenciais para continuar.",
    `
      ${
        successMessage
          ? `<div class="success-box">${escapeHtml(successMessage)}</div>`
          : ""
      }

      <label>
        E-mail
        <input
          id="email"
          type="email"
          placeholder="seu@email.com"
          required>
      </label>

      <label>
        Senha
        <input
          id="password"
          type="password"
          placeholder="Sua senha"
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
    message.className = "auth-message";

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

async function dashboard() {
  try {
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

        <div class="card">
          <span>Contratos ativos</span>
          <strong>${data.contracts || 0}</strong>
          <small>
            Contratos cadastrados
          </small>
        </div>

        <div class="card">
          <span>Colaboradores</span>
          <strong>${data.employees || 0}</strong>
          <small>
            Colaboradores ativos
          </small>
        </div>

        <div class="card">
          <span>Horas extras</span>
          <strong>${data.overtime || 0}</strong>
          <small>
            No mês atual
          </small>
        </div>

        <div class="card">
          <span>Pendências</span>
          <strong>${data.pending || 0}</strong>
          <small>
            Aguardando ação
          </small>
        </div>

      </div>

      <div class="dashboard-grid">

        <div class="panel">

          <div class="panel-title">
            <h3>Coberturas recentes</h3>

            <button
              onclick="render('coberturas')">
              Ver todas
            </button>
          </div>

          <div class="empty">
            <div class="empty-icon">🤖</div>

            <h3>
              Nenhuma cobertura registrada
            </h3>

            <p>
              As coberturas realizadas aparecerão aqui.
            </p>
          </div>

        </div>

        <div class="panel">

          <div class="panel-title">
            <h3>
              Central de Pendências
            </h3>
          </div>

          <div class="pending-item">
            <span>
              📄 Folhas de ponto
            </span>
            <strong>0</strong>
          </div>

          <div class="pending-item">
            <span>
              🎓 Treinamentos
            </span>
            <strong>0</strong>
          </div>

          <div class="pending-item">
            <span>
              ⚠️ Outras solicitações
            </span>
            <strong>${data.pending || 0}</strong>
          </div>

        </div>

      </div>
    `;

  } catch (error) {
    return errorPage(error.message);
  }
}

async function contractsPage() {
  try {
    const contracts =
      await api("/api/contracts");

    return `
      <div class="page-header">

        <div>
          <h1>Contratos / CR</h1>
          <p>
            Gerencie os contratos da operação
          </p>
        </div>

        <button
          class="primary"
          onclick="showContractForm()">
          + Novo Contrato
        </button>

      </div>

      <div
        id="contractFormArea">
      </div>

      <div class="panel">

        <div class="panel-title">
          <h3>
            Contratos cadastrados
          </h3>

          <span>
            ${contracts.length}
          </span>
        </div>

        ${
          contracts.length
            ? `
              <div class="table-wrap">

                <table class="data-table">

                  <thead>
                    <tr>
                      <th>CR</th>
                      <th>Contrato</th>
                      <th>Status</th>
                      <th>Ação</th>
                    </tr>
                  </thead>

                  <tbody>

                    ${contracts
                      .map(
                        contract => `
                          <tr>

                            <td>
                              <strong>
                                ${escapeHtml(contract.cr)}
                              </strong>
                            </td>

                            <td>
                              ${escapeHtml(contract.name)}
                            </td>

                            <td>
                              <span class="badge ${
                                contract.active
                                  ? "active-badge"
                                  : "inactive-badge"
                              }">
                                ${
                                  contract.active
                                    ? "Ativo"
                                    : "Inativo"
                                }
                              </span>
                            </td>

                            <td>

                              ${
                                contract.active
                                  ? `
                                    <button
                                      class="small-button"
                                      onclick="deactivateContract(${contract.id})">
                                      Desativar
                                    </button>
                                  `
                                  : `
                                    <button
                                      class="small-button"
                                      onclick="reactivateContract(
                                        ${contract.id},
                                        '${escapeHtml(contract.cr)}',
                                        '${escapeHtml(contract.name)}'
                                      )">
                                      Reativar
                                    </button>
                                  `
                              }

                            </td>

                          </tr>
                        `
                      )
                      .join("")}

                  </tbody>

                </table>

              </div>
            `
            : `
              <div class="empty">

                <div class="empty-icon">
                  🏢
                </div>

                <h3>
                  Nenhum contrato cadastrado
                </h3>

                <p>
                  Clique em Novo Contrato para começar.
                </p>

              </div>
            `
        }

      </div>
    `;

  } catch (error) {
    return errorPage(error.message);
  }
}

function showContractForm() {
  const area =
    document.getElementById(
      "contractFormArea"
    );

  area.innerHTML = `
    <div class="panel form-panel">

      <div class="panel-title">
        <h3>Novo Contrato</h3>

        <button
          onclick="closeContractForm()">
          ✕
        </button>
      </div>

      <form
        id="contractForm"
        class="contract-form">

        <label>
          CR
          <input
            id="contractCR"
            type="text"
            placeholder="Ex.: 12345"
            required>
        </label>

        <label>
          Nome do contrato
          <input
            id="contractName"
            type="text"
            placeholder="Ex.: Buriti Shopping"
            required>
        </label>

        <div
          id="contractMessage"
          class="auth-message">
        </div>

        <button
          type="submit"
          class="primary">
          Salvar Contrato
        </button>

      </form>

    </div>
  `;

  document
    .getElementById("contractForm")
    .addEventListener(
      "submit",
      saveContract
    );
}

function closeContractForm() {
  document.getElementById(
    "contractFormArea"
  ).innerHTML = "";
}

async function saveContract(event) {
  event.preventDefault();

  const message =
    document.getElementById(
      "contractMessage"
    );

  try {
    message.textContent =
      "Salvando...";

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

    await render("contratos");

  } catch (error) {
    message.textContent =
      error.message;

    message.className =
      "auth-message error";
  }
}

async function deactivateContract(id) {
  if (
    !confirm(
      "Deseja desativar este contrato?"
    )
  ) {
    return;
  }

  try {
    const contracts =
      await api("/api/contracts");

    const contract =
      contracts.find(
        item => item.id === id
      );

    if (!contract) return;

    await api(
      `/api/contracts/${id}`,
      {
        method: "PUT",
        body: JSON.stringify({
          cr: contract.cr,
          name: contract.name,
          active: false
        })
      }
    );

    await render("contratos");

  } catch (error) {
    alert(error.message);
  }
}

async function reactivateContract(
  id,
  cr,
  name
) {
  try {
    await api(
      `/api/contracts/${id}`,
      {
        method: "PUT",
        body: JSON.stringify({
          cr,
          name,
          active: true
        })
      }
    );

    await render("contratos");

  } catch (error) {
    alert(error.message);
  }
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

        <div class="empty-icon">
          🚧
        </div>

        <h3>${title}</h3>

        <p>
          Este módulo será liberado
          nas próximas etapas.
        </p>

      </div>

    </div>
  `;
}

function errorPage(message) {
  return `
    <div class="panel">

      <div class="empty">

        <div class="empty-icon">
          ⚠️
        </div>

        <h3>
          Não foi possível carregar
        </h3>

        <p>
          ${escapeHtml(message)}
        </p>

      </div>

    </div>
  `;
}

async function render(page = "dashboard") {
  currentPage = page;

  const current =
    menu.find(
      item => item[0] === page
    );

  const title =
    current
      ? current[2]
      : "Dashboard";

  app.innerHTML = `
    <aside class="sidebar">

      <div class="brand">

        <div class="brand-icon">
          O
        </div>

        <div>
          <strong>OPERA IA</strong>
          <small>
            Gestão Inteligente
          </small>
        </div>

      </div>

      <nav>

        ${menu
          .map(
            item => `
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
            `
          )
          .join("")}

      </nav>

      <div class="sidebar-footer">

        <div class="user-avatar">
          ${
            currentUser?.name
              ? currentUser.name
                  .substring(0, 2)
                  .toUpperCase()
              : "AD"
          }
        </div>

        <div>
          <strong>
            ${escapeHtml(
              currentUser?.name ||
              "Administrador"
            )}
          </strong>

          <small>
            ${escapeHtml(
              currentUser?.role ||
              "ADM"
            )}
          </small>
        </div>

      </div>

    </aside>

    <main class="main">

      <header class="topbar">

        <div>
          <strong>OPERA IA</strong>

          <span>
            A inteligência que conecta
            pessoas às operações.
          </span>
        </div>

        <div class="topbar-actions">

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
        class="content"
        id="pageContent">

        <div class="empty">
          <p>Carregando...</p>
        </div>

      </section>

    </main>
  `;

  let content;

  if (page === "dashboard") {
    content = await dashboard();

  } else if (page === "contratos") {
    content = await contractsPage();

  } else {
    content = genericPage(title);
  }

  const pageContent =
    document.getElementById(
      "pageContent"
    );

  if (pageContent) {
    pageContent.innerHTML = content;
  }
}

async function start() {
  try {
    const setup =
      await api("/api/setup-status");

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
        JSON.stringify(currentUser)
      );

      render("dashboard");

    } catch {
      logout();
    }

  } catch (error) {
    app.innerHTML = `
      <div class="auth-page">

        <div class="auth-card">

          <div class="auth-logo">
            O
          </div>

          <h1>OPERA IA</h1>

          <h2>
            Sistema indisponível
          </h2>

          <p>
            ${escapeHtml(error.message)}
          </p>

        </div>

      </div>
    `;
  }
}

start();

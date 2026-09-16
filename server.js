const express = require("express");
const path = require("path");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();

app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "public")));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

const JWT_SECRET =
  process.env.SESSION_SECRET ||
  process.env.JWT_SECRET ||
  "opera-ia-temporary-secret";

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'ADM',
      active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS contracts (
      id SERIAL PRIMARY KEY,
      cr TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      active BOOLEAN DEFAULT true
    );

    CREATE TABLE IF NOT EXISTS employees (
      id SERIAL PRIMARY KEY,
      registration TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      phone TEXT,
      contract_id INT REFERENCES contracts(id),
      role TEXT,
      shift TEXT,
      schedule TEXT,
      active BOOLEAN DEFAULT true
    );

    CREATE TABLE IF NOT EXISTS overtime (
      id SERIAL PRIMARY KEY,
      employee_id INT REFERENCES employees(id),
      work_date DATE NOT NULL,
      hours NUMERIC(6,2) DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS requests (
      id SERIAL PRIMARY KEY,
      employee_id INT REFERENCES employees(id),
      type TEXT NOT NULL,
      reference TEXT,
      message TEXT,
      status TEXT DEFAULT 'Pendente',
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
}

function auth(req, res, next) {
  const token = (req.headers.authorization || "")
    .replace(/^Bearer\s+/, "");

  if (!token) {
    return res.status(401).json({
      error: "Não autenticado",
    });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({
      error: "Sessão inválida",
    });
  }
}

/* =========================
   SISTEMA
========================= */

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    app: "OPERA IA",
  });
});

/* =========================
   PRIMEIRO ACESSO ADM
========================= */

app.get("/api/setup-status", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT count(*)::int AS count FROM users"
    );

    res.json({
      needsSetup: result.rows[0].count === 0,
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});

app.post("/api/setup", async (req, res) => {
  try {
    const existing = await pool.query(
      "SELECT count(*)::int AS count FROM users"
    );

    if (existing.rows[0].count > 0) {
      return res.status(403).json({
        error: "Configuração inicial já concluída",
      });
    }

    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        error: "Preencha todos os campos",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        error: "A senha deve possuir pelo menos 8 caracteres",
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `
      INSERT INTO users
      (name, email, password_hash, role)
      VALUES ($1,$2,$3,'ADM')
      RETURNING id,name,email,role
      `,
      [
        name.trim(),
        email.toLowerCase().trim(),
        passwordHash,
      ]
    );

    res.json({
      success: true,
      user: result.rows[0],
    });
  } catch (error) {
    res.status(400).json({
      error: error.message,
    });
  }
});

/* =========================
   LOGIN
========================= */

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await pool.query(
      `
      SELECT *
      FROM users
      WHERE email=$1
      AND active=true
      `,
      [String(email || "").toLowerCase().trim()]
    );

    if (!result.rowCount) {
      return res.status(401).json({
        error: "E-mail ou senha inválidos",
      });
    }

    const user = result.rows[0];

    const validPassword = await bcrypt.compare(
      password || "",
      user.password_hash
    );

    if (!validPassword) {
      return res.status(401).json({
        error: "E-mail ou senha inválidos",
      });
    }

    const token = jwt.sign(
      {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      JWT_SECRET,
      {
        expiresIn: "12h",
      }
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});

app.get("/api/me", auth, (req, res) => {
  res.json(req.user);
});

/* =========================
   DASHBOARD
========================= */

app.get("/api/dashboard", auth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
      (
        SELECT count(*)
        FROM contracts
        WHERE active
      )::int AS contracts,

      (
        SELECT count(*)
        FROM employees
        WHERE active
      )::int AS employees,

      (
        SELECT COALESCE(sum(hours),0)
        FROM overtime
        WHERE date_trunc('month',work_date)
        =
        date_trunc('month',current_date)
      ) AS overtime,

      (
        SELECT count(*)
        FROM requests
        WHERE status='Pendente'
      )::int AS pending
    `);

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});

/* =========================
   CONTRATOS / CR
========================= */

app.get("/api/contracts", auth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM contracts
      ORDER BY active DESC, name
    `);

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});

app.post("/api/contracts", auth, async (req, res) => {
  try {
    const { cr, name } = req.body;

    if (!cr || !name) {
      return res.status(400).json({
        error: "Informe CR e nome do contrato",
      });
    }

    const result = await pool.query(
      `
      INSERT INTO contracts
      (cr,name)
      VALUES ($1,$2)

      ON CONFLICT(cr)
      DO UPDATE SET
        name=EXCLUDED.name,
        active=true

      RETURNING *
      `,
      [
        String(cr).trim(),
        String(name).trim(),
      ]
    );

    res.json(result.rows[0]);
  } catch (error) {
    res.status(400).json({
      error: error.message,
    });
  }
});

app.put("/api/contracts/:id", auth, async (req, res) => {
  try {
    const { cr, name, active } = req.body;

    const result = await pool.query(
      `
      UPDATE contracts
      SET
        cr=$1,
        name=$2,
        active=$3
      WHERE id=$4
      RETURNING *
      `,
      [
        cr,
        name,
        active !== false,
        req.params.id,
      ]
    );

    if (!result.rowCount) {
      return res.status(404).json({
        error: "Contrato não encontrado",
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(400).json({
      error: error.message,
    });
  }
});

app.delete("/api/contracts/:id", auth, async (req, res) => {
  try {
    await pool.query(
      `
      UPDATE contracts
      SET active=false
      WHERE id=$1
      `,
      [req.params.id]
    );

    res.json({
      success: true,
    });
  } catch (error) {
    res.status(400).json({
      error: error.message,
    });
  }
});

/* =========================
   COLABORADORES
========================= */

app.post("/api/employees", auth, async (req, res) => {
  try {
    const {
      registration,
      name,
      phone,
      cr,
      role,
      shift,
      schedule,
    } = req.body;

    const contract = await pool.query(
      `
      SELECT id
      FROM contracts
      WHERE cr=$1
      `,
      [cr]
    );

    if (!contract.rowCount) {
      return res.status(400).json({
        error: "CR não cadastrado",
      });
    }

    const result = await pool.query(
      `
      INSERT INTO employees
      (
        registration,
        name,
        phone,
        contract_id,
        role,
        shift,
        schedule
      )

      VALUES
      ($1,$2,$3,$4,$5,$6,$7)

      ON CONFLICT(registration)

      DO UPDATE SET
        name=EXCLUDED.name,
        phone=EXCLUDED.phone,
        contract_id=EXCLUDED.contract_id,
        role=EXCLUDED.role,
        shift=EXCLUDED.shift,
        schedule=EXCLUDED.schedule

      RETURNING *
      `,
      [
        registration,
        name,
        phone,
        contract.rows[0].id,
        role,
        shift,
        schedule,
      ]
    );

    res.json(result.rows[0]);
  } catch (error) {
    res.status(400).json({
      error: error.message,
    });
  }
});

/* =========================
   FRONT-END
========================= */

app.get("*", (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );
});

/* =========================
   INICIALIZAÇÃO
========================= */

const PORT = process.env.PORT || 3000;

init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(
        `OPERA IA online na porta ${PORT}`
      );
    });
  })
  .catch((error) => {
    console.error(
      "Erro ao iniciar OPERA IA:",
      error
    );

    process.exit(1);
  });

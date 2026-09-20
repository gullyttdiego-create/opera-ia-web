const express = require("express");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const XLSX = require("xlsx");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET =
  process.env.SESSION_SECRET ||
  process.env.JWT_SECRET ||
  "opera-ia-temporary-secret";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

/* =========================================================
   BANCO DE DADOS
========================================================= */

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(150) NOT NULL,
      email VARCHAR(180) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role VARCHAR(30) DEFAULT 'ADM',
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS contracts (
      id SERIAL PRIMARY KEY,
      cr VARCHAR(80) UNIQUE NOT NULL,
      name VARCHAR(180) NOT NULL,
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS posts (
      id SERIAL PRIMARY KEY,
      contract_id INTEGER REFERENCES contracts(id) ON DELETE CASCADE,
      name VARCHAR(180) NOT NULL,
      description TEXT,
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS employees (
      id SERIAL PRIMARY KEY,
      registration VARCHAR(80) UNIQUE NOT NULL,
      name VARCHAR(180) NOT NULL,
      phone VARCHAR(40),
      contract_id INTEGER REFERENCES contracts(id),
      post_id INTEGER REFERENCES posts(id),
      role VARCHAR(120),
      shift VARCHAR(40),
      schedule VARCHAR(80),
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS overtime (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
      work_date DATE NOT NULL,
      hours NUMERIC(10,2) DEFAULT 0,
      description TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS requests (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
      contract_id INTEGER REFERENCES contracts(id),
      type VARCHAR(50) NOT NULL,
      reference VARCHAR(120),
      message TEXT,
      status VARCHAR(40) DEFAULT 'PENDENTE',
      sent_at TIMESTAMP,
      completed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS coverages (
      id SERIAL PRIMARY KEY,
      contract_id INTEGER REFERENCES contracts(id),
      post_id INTEGER REFERENCES posts(id),
      absent_employee_id INTEGER REFERENCES employees(id),
      selected_employee_id INTEGER REFERENCES employees(id),
      coverage_date DATE NOT NULL,
      shift VARCHAR(80),
      reason TEXT,
      status VARCHAR(40) DEFAULT 'ABERTA',
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      confirmed_at TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS coverage_candidates (
      id SERIAL PRIMARY KEY,
      coverage_id INTEGER REFERENCES coverages(id) ON DELETE CASCADE,
      employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
      score NUMERIC(10,2) DEFAULT 0,
      position INTEGER,
      status VARCHAR(40) DEFAULT 'PENDENTE',
      contacted_at TIMESTAMP,
      responded_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(coverage_id, employee_id)
    );

    CREATE TABLE IF NOT EXISTS user_contracts (
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      contract_id INTEGER REFERENCES contracts(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, contract_id)
    );

  ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS post_id INTEGER REFERENCES posts(id);

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS role VARCHAR(120);

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS shift VARCHAR(40);

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS schedule VARCHAR(80);

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT TRUE;

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS phone VARCHAR(40);

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS contract_id INTEGER REFERENCES contracts(id); 
    
    
    
    
    CREATE INDEX IF NOT EXISTS idx_employees_contract
      ON employees(contract_id);

    CREATE INDEX IF NOT EXISTS idx_employees_post
      ON employees(post_id);

    CREATE INDEX IF NOT EXISTS idx_overtime_employee
      ON overtime(employee_id);

    CREATE INDEX IF NOT EXISTS idx_requests_employee
      ON requests(employee_id);

    CREATE INDEX IF NOT EXISTS idx_coverages_date
      ON coverages(coverage_date);
  `);

  console.log("OPERA IA: banco inicializado.");
}

/* =========================================================
   UTILITÁRIOS
========================================================= */

function normalizePhone(phone = "") {
  let value = String(phone).replace(/\D/g, "");

  if (value && value.length <= 11) {
    value = `55${value}`;
  }

  return value;
}

function nullableText(value) {
  if (value === undefined || value === null) return null;

  const text = String(value).trim();
  return text || null;
}

function nullableId(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : NaN;
}

async function validateEmployeeAssignment(contractId, postId) {
  if (Number.isNaN(contractId) || Number.isNaN(postId)) {
    return "Contrato ou posto inválido.";
  }

  if (!postId) return null;

  const post = await pool.query(
    `
    SELECT contract_id
    FROM posts
    WHERE id=$1 AND active=TRUE
    `,
    [postId]
  );

  if (!post.rows[0]) return "Posto não encontrado ou inativo.";

  if (!contractId || Number(post.rows[0].contract_id) !== contractId) {
    return "O posto selecionado não pertence ao contrato informado.";
  }

  return null;
}

function normalizeShift(value = "") {
  const v = String(value).trim().toUpperCase();

  if (
    v.includes("IMPAR") ||
    v.includes("ÍMPAR")
  ) {
    return "IMPAR";
  }

  if (v.includes("PAR")) {
    return "PAR";
  }

  return v;
}

function oppositeShift(shift) {
  const value = normalizeShift(shift);

  if (value === "IMPAR") return "PAR";
  if (value === "PAR") return "IMPAR";

  return null;
}

function excelDate(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);

    if (parsed) {
      return `${parsed.y}-${String(parsed.m).padStart(
        2,
        "0"
      )}-${String(parsed.d).padStart(2, "0")}`;
    }
  }

  const text = String(value).trim();

  const br = text.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
  );

  if (br) {
    return `${br[3]}-${br[2].padStart(
      2,
      "0"
    )}-${br[1].padStart(2, "0")}`;
  }

  const date = new Date(text);

  if (!Number.isNaN(date.getTime())) {
    return date.toISOString().slice(0, 10);
  }

  return null;
}

function firstValue(row, names) {
  const keys = Object.keys(row);

  for (const name of names) {
    const found = keys.find(
      key =>
        String(key)
          .trim()
          .toLowerCase() ===
        name.toLowerCase()
    );

    if (
      found &&
      row[found] !== undefined &&
      row[found] !== null &&
      row[found] !== ""
    ) {
      return row[found];
    }
  }

  return "";
}

function auth(req, res, next) {
  const header =
    req.headers.authorization || "";

  const token =
    header.startsWith("Bearer ")
      ? header.slice(7)
      : null;

  if (!token) {
    return res
      .status(401)
      .json({ error: "Não autenticado." });
  }

  try {
    req.user = jwt.verify(
      token,
      JWT_SECRET
    );

    next();
  } catch {
    return res
      .status(401)
      .json({ error: "Sessão inválida." });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== "ADM") {
    return res.status(403).json({
      error:
        "Acesso permitido apenas ao administrador."
    });
  }

  next();
}

/* =========================================================
   SISTEMA / AUTENTICAÇÃO
========================================================= */

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      ok: true,
      system: "OPERA IA",
      database: "online"
    });
  } catch {
    res.status(500).json({
      ok: false,
      database: "offline"
    });
  }
});

app.get(
  "/api/setup-status",
  async (req, res) => {
    const result = await pool.query(
      "SELECT COUNT(*)::int AS total FROM users"
    );

    res.json({
      needsSetup:
        result.rows[0].total === 0
    });
  }
);

app.post("/api/setup", async (req, res) => {
  try {
    const count = await pool.query(
      "SELECT COUNT(*)::int AS total FROM users"
    );

    if (count.rows[0].total > 0) {
      return res.status(403).json({
        error:
          "O administrador inicial já foi criado."
      });
    }

    const { name, email, password } =
      req.body;

    if (
      !name ||
      !email ||
      !password ||
      password.length < 8
    ) {
      return res.status(400).json({
        error:
          "Informe nome, e-mail e senha com pelo menos 8 caracteres."
      });
    }

    const hash = await bcrypt.hash(
      password,
      12
    );

    const result = await pool.query(
      `
      INSERT INTO users
        (name,email,password_hash,role)
      VALUES ($1,$2,$3,'ADM')
      RETURNING id,name,email,role
      `,
      [
        name.trim(),
        email.trim().toLowerCase(),
        hash
      ]
    );

    res.status(201).json(
      result.rows[0]
    );
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error:
        "Não foi possível criar o administrador."
    });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const email = String(
      req.body.email || ""
    )
      .trim()
      .toLowerCase();

    const password =
      req.body.password || "";

    const result = await pool.query(
      `
      SELECT *
      FROM users
      WHERE email=$1
        AND active=TRUE
      `,
      [email]
    );

    const user = result.rows[0];

    if (
      !user ||
      !(await bcrypt.compare(
        password,
        user.password_hash
      ))
    ) {
      return res.status(401).json({
        error:
          "E-mail ou senha inválidos."
      });
    }

    const publicUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
    };

    const token = jwt.sign(
      publicUser,
      JWT_SECRET,
      { expiresIn: "12h" }
    );

    res.json({
      token,
      user: publicUser
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error:
        "Não foi possível realizar o login."
    });
  }
});

app.get("/api/me", auth, (req, res) => {
  res.json(req.user);
});

/* =========================================================
   DASHBOARD
========================================================= */

app.get(
  "/api/dashboard",
  auth,
  async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT
          (
            SELECT COUNT(*)::int
            FROM contracts
            WHERE active=TRUE
          ) AS contracts,

          (
            SELECT COUNT(*)::int
            FROM posts
            WHERE active=TRUE
          ) AS posts,

          (
            SELECT COUNT(*)::int
            FROM employees
            WHERE active=TRUE
          ) AS employees,

          (
            SELECT COALESCE(
              SUM(hours),
              0
            )::float
            FROM overtime
            WHERE DATE_TRUNC(
              'month',
              work_date
            ) =
            DATE_TRUNC(
              'month',
              CURRENT_DATE
            )
          ) AS overtime,

          (
            SELECT COUNT(*)::int
            FROM requests
            WHERE status='PENDENTE'
          ) AS pending,

          (
            SELECT COUNT(*)::int
            FROM coverages
            WHERE coverage_date =
              CURRENT_DATE
          ) AS coverages_today
      `);

      res.json(result.rows[0]);
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error:
          "Erro ao carregar dashboard."
      });
    }
  }
);

/* =========================================================
   CONTRATOS
========================================================= */

app.get(
  "/api/contracts",
  auth,
  async (req, res) => {
    const result = await pool.query(`
      SELECT
        c.*,
        COUNT(
          DISTINCT e.id
        )::int AS employees,
        COUNT(
          DISTINCT p.id
        )::int AS posts
      FROM contracts c
      LEFT JOIN employees e
        ON e.contract_id=c.id
        AND e.active=TRUE
      LEFT JOIN posts p
        ON p.contract_id=c.id
        AND p.active=TRUE
      GROUP BY c.id
      ORDER BY c.active DESC,c.name
    `);

    res.json(result.rows);
  }
);

app.post(
  "/api/contracts",
  auth,
  async (req, res) => {
    try {
      const cr = String(
        req.body.cr || ""
      ).trim();

      const name = String(
        req.body.name || ""
      ).trim();

      if (!cr || !name) {
        return res.status(400).json({
          error:
            "Informe CR e nome do contrato."
        });
      }

      const result = await pool.query(
        `
        INSERT INTO contracts
          (cr,name,active)
        VALUES ($1,$2,TRUE)
        ON CONFLICT (cr)
        DO UPDATE SET
          name=EXCLUDED.name,
          active=TRUE
        RETURNING *
        `,
        [cr, name]
      );

      res.status(201).json(
        result.rows[0]
      );
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error:
          "Erro ao salvar contrato."
      });
    }
  }
);

app.put(
  "/api/contracts/:id",
  auth,
  async (req, res) => {
    const { cr, name, active } =
      req.body;

    const result = await pool.query(
      `
      UPDATE contracts
      SET
        cr=COALESCE($1,cr),
        name=COALESCE($2,name),
        active=COALESCE($3,active)
      WHERE id=$4
      RETURNING *
      `,
      [
        cr || null,
        name || null,
        active === undefined
          ? null
          : active,
        req.params.id
      ]
    );

    res.json(result.rows[0]);
  }
);

app.delete(
  "/api/contracts/:id",
  auth,
  async (req, res) => {
    await pool.query(
      `
      UPDATE contracts
      SET active=FALSE
      WHERE id=$1
      `,
      [req.params.id]
    );

    res.json({ ok: true });
  }
);

/* =========================================================
   POSTOS
========================================================= */

app.get(
  "/api/posts",
  auth,
  async (req, res) => {
    const contractId =
      req.query.contract_id;

    const params = [];
    let where = "";

    if (contractId) {
      params.push(contractId);
      where =
        "WHERE p.contract_id=$1";
    }

    const result = await pool.query(
      `
      SELECT
        p.*,
        c.name AS contract_name,
        c.cr,
        COUNT(e.id)::int AS employees
      FROM posts p
      JOIN contracts c
        ON c.id=p.contract_id
      LEFT JOIN employees e
        ON e.post_id=p.id
        AND e.active=TRUE
      ${where}
      GROUP BY
        p.id,
        c.name,
        c.cr
      ORDER BY
        p.active DESC,
        c.name,
        p.name
      `,
      params
    );

    res.json(result.rows);
  }
);

app.post(
  "/api/posts",
  auth,
  async (req, res) => {
    const {
      contract_id,
      name,
      description
    } = req.body;

    if (!contract_id || !name) {
      return res.status(400).json({
        error:
          "Informe contrato e nome do posto."
      });
    }

    const result = await pool.query(
      `
      INSERT INTO posts
        (
          contract_id,
          name,
          description
        )
      VALUES ($1,$2,$3)
      RETURNING *
      `,
      [
        contract_id,
        String(name).trim(),
        description || null
      ]
    );

    res.status(201).json(
      result.rows[0]
    );
  }
);

app.put(
  "/api/posts/:id",
  auth,
  async (req, res) => {
    const {
      contract_id,
      name,
      description,
      active
    } = req.body;

    const result = await pool.query(
      `
      UPDATE posts
      SET
        contract_id=
          COALESCE($1,contract_id),
        name=COALESCE($2,name),
        description=
          COALESCE($3,description),
        active=
          COALESCE($4,active)
      WHERE id=$5
      RETURNING *
      `,
      [
        contract_id || null,
        name || null,
        description === undefined
          ? null
          : description,
        active === undefined
          ? null
          : active,
        req.params.id
      ]
    );

    res.json(result.rows[0]);
  }
);

app.delete(
  "/api/posts/:id",
  auth,
  async (req, res) => {
    await pool.query(
      `
      UPDATE posts
      SET active=FALSE
      WHERE id=$1
      `,
      [req.params.id]
    );

    res.json({ ok: true });
  }
);

/* =========================================================
   COLABORADORES
========================================================= */

app.get(
  "/api/employees",
  auth,
  async (req, res) => {
    const values = [];
    const filters = [];

    if (req.query.contract_id) {
      values.push(
        req.query.contract_id
      );

      filters.push(
        `e.contract_id=$${values.length}`
      );
    }

    if (req.query.post_id) {
      values.push(req.query.post_id);

      filters.push(
        `e.post_id=$${values.length}`
      );
    }

    if (req.query.search) {
      values.push(
        `%${req.query.search}%`
      );

      filters.push(`
        (
          e.name ILIKE $${values.length}
          OR
          e.registration ILIKE $${values.length}
        )
      `);
    }

    const where =
      filters.length
        ? `WHERE ${filters.join(
            " AND "
          )}`
        : "";

    const result = await pool.query(
      `
      SELECT
        e.*,
        c.name AS contract_name,
        c.cr,
        p.name AS post_name,
        COALESCE(
          SUM(
            CASE
              WHEN o.work_date >=
                CURRENT_DATE -
                INTERVAL '90 days'
              THEN o.hours
              ELSE 0
            END
          ),
          0
        )::float AS overtime_90d
      FROM employees e
      LEFT JOIN contracts c
        ON c.id=e.contract_id
      LEFT JOIN posts p
        ON p.id=e.post_id
      LEFT JOIN overtime o
        ON o.employee_id=e.id
      ${where}
      GROUP BY
        e.id,
        c.name,
        c.cr,
        p.name
      ORDER BY
        e.active DESC,
        e.name
      `,
      values
    );

    res.json(result.rows);
  }
);

app.post(
  "/api/employees",
  auth,
  async (req, res) => {
    try {
      const {
        registration,
        name,
        phone,
        contract_id,
        post_id,
        role,
        shift,
        schedule
      } = req.body;

      if (!registration || !name) {
        return res.status(400).json({
          error:
            "Informe matrícula e nome."
        });
      }

      const contractId = nullableId(contract_id);
      const postId = nullableId(post_id);
      const assignmentError = await validateEmployeeAssignment(
        contractId,
        postId
      );

      if (assignmentError) {
        return res.status(400).json({ error: assignmentError });
      }

      const result = await pool.query(
        `
        INSERT INTO employees
          (
            registration,
            name,
            phone,
            contract_id,
            post_id,
            role,
            shift,
            schedule,
            active
          )
        VALUES
          (
            $1,$2,$3,$4,$5,
            $6,$7,$8,TRUE
          )
        RETURNING *
        `,
        [
          String(registration).trim(),
          String(name).trim(),
          nullableText(normalizePhone(phone)),
          contractId,
          postId,
          nullableText(role),
          nullableText(shift)
            ? normalizeShift(shift)
            : null,
          nullableText(schedule)
        ]
      );

      res.status(201).json(
        result.rows[0]
      );
    } catch (error) {
      console.error(error);

      const duplicate = error.code === "23505";

      res.status(duplicate ? 409 : 500).json({
        error:
          duplicate
            ? "Já existe um colaborador com esta matrícula."
            : "Erro ao salvar colaborador."
      });
    }
  }
);

app.put(
  "/api/employees/:id",
  auth,
  async (req, res) => {
    try {
      const {
        registration,
        name,
        phone,
        contract_id,
        post_id,
        role,
        shift,
        schedule,
        active
      } = req.body;

      if (!nullableText(registration) || !nullableText(name)) {
        return res.status(400).json({
          error: "Informe matrícula e nome."
        });
      }

      const contractId = nullableId(contract_id);
      const postId = nullableId(post_id);
      const assignmentError = await validateEmployeeAssignment(
        contractId,
        postId
      );

      if (assignmentError) {
        return res.status(400).json({ error: assignmentError });
      }

      const result = await pool.query(
        `
        UPDATE employees
        SET
          registration=$1,
          name=$2,
          phone=$3,
          contract_id=$4,
          post_id=$5,
          role=$6,
          shift=$7,
          schedule=$8,
          active=$9,
          updated_at=NOW()
        WHERE id=$10
        RETURNING *
        `,
        [
          nullableText(registration),
          nullableText(name),
          nullableText(normalizePhone(phone)),
          contractId,
          postId,
          nullableText(role),
          nullableText(shift)
            ? normalizeShift(shift)
            : null,
          nullableText(schedule),
          active !== false,
          req.params.id
        ]
      );

      if (!result.rows[0]) {
        return res.status(404).json({
          error: "Colaborador não encontrado."
        });
      }

      res.json(result.rows[0]);
    } catch (error) {
      console.error(error);
      const duplicate = error.code === "23505";

      res.status(duplicate ? 409 : 500).json({
        error: duplicate
          ? "Já existe um colaborador com esta matrícula."
          : "Erro ao atualizar colaborador."
      });
    }
  }
);

app.delete(
  "/api/employees/:id",
  auth,
  async (req, res) => {
    await pool.query(
      `
      UPDATE employees
      SET
        active=FALSE,
        updated_at=NOW()
      WHERE id=$1
      `,
      [req.params.id]
    );

    res.json({ ok: true });
  }
);

/* =========================================================
   IMPORTAÇÃO DE COLABORADORES
========================================================= */

/* =========================================================
   IMPORTAÇÃO DE COLABORADORES
   Compatível com planilha OPERA IA e modelo GPS
   ========================================================= */

app.post(
  "/api/import/employees",
  auth,
  upload.single("file"),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({
        error: "Selecione uma planilha."
      });
    }

    try {
      const workbook = XLSX.read(req.file.buffer, {
        type: "buffer"
      });

      const sheet =
        workbook.Sheets[workbook.SheetNames[0]];

      const rows = XLSX.utils.sheet_to_json(sheet, {
        defval: "",
        raw: false
      });

      if (!rows.length) {
        return res.status(400).json({
          error: "A planilha está vazia."
        });
      }

      let imported = 0;
      let updated = 0;
      let skipped = 0;

      const errors = [];
      const createdContracts = [];

      /* -----------------------------------------
         FUNÇÕES AUXILIARES
         ----------------------------------------- */

      const getValue = (row, names) => {
        for (const name of names) {
          const key = Object.keys(row).find(
            k =>
              String(k)
                .trim()
                .toUpperCase() ===
              String(name)
                .trim()
                .toUpperCase()
          );

          if (
            key !== undefined &&
            row[key] !== undefined &&
            row[key] !== null &&
            String(row[key]).trim() !== ""
          ) {
            return String(row[key]).trim();
          }
        }

        return "";
      };

      const splitCodeAndName = value => {
        const text = String(value || "").trim();

        if (!text) {
          return {
            code: "",
            name: ""
          };
        }

        /*
         * Exemplos:
         *
         * 011881 - ALMIR RAFAEL GOMES DA SILVA
         * 87664 - GO - SEG - BURITI SHOPPING
         */

        const match = text.match(
          /^([A-Za-z0-9._/]+)\s*-\s*(.+)$/
        );

        if (match) {
          return {
            code: match[1].trim(),
            name: match[2].trim()
          };
        }

        return {
          code: "",
          name: text
        };
      };

      /* -----------------------------------------
         PROCESSAMENTO
         ----------------------------------------- */

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];

        try {
          /* =====================================
             COLABORADOR
             ===================================== */

          const collaboratorRaw = getValue(row, [
            "COLABORADOR",
            "Colaborador",
            "FUNCIONARIO",
            "FUNCIONÁRIO",
            "EMPLOYEE"
          ]);

          let registration = getValue(row, [
            "MATRICULA",
            "MATRÍCULA",
            "REGISTRATION"
          ]);

          let employeeName = getValue(row, [
            "NOME",
            "Nome",
            "NAME"
          ]);

          if (collaboratorRaw) {
            const collaborator =
              splitCodeAndName(collaboratorRaw);

            if (!registration) {
              registration =
                collaborator.code;
            }

            if (!employeeName) {
              employeeName =
                collaborator.name;
            }
          }

          registration =
            String(registration || "")
              .trim();

          employeeName =
            String(employeeName || "")
              .trim();

          /*
           * Preserva matrículas como:
           * 000818
           * 011881
           */

          if (!registration || !employeeName) {
            skipped++;

            errors.push({
              row: i + 2,
              error:
                "Matrícula ou nome do colaborador não identificado."
            });

            continue;
          }

          /* =====================================
             CONTRATO / CR
             ===================================== */

          const crRaw = getValue(row, [
            "CR",
            "CONTRATO",
            "Contrato"
          ]);

          let contractCode = "";
          let contractName = "";

          if (crRaw) {
            const contract =
              splitCodeAndName(crRaw);

            contractCode =
              contract.code ||
              String(crRaw).trim();

            contractName =
              contract.name ||
              String(crRaw).trim();
          }

          let contractId = null;

          if (contractCode) {
            let contractResult =
              await pool.query(
                `
                SELECT id, name
                FROM contracts
                WHERE cr = $1
                LIMIT 1
                `,
                [contractCode]
              );

            if (!contractResult.rows[0]) {
              contractResult =
                await pool.query(
                  `
                  INSERT INTO contracts
                    (cr, name, active)
                  VALUES
                    ($1, $2, TRUE)
                  RETURNING id, name
                  `,
                  [
                    contractCode,
                    contractName ||
                      `CR ${contractCode}`
                  ]
                );

              createdContracts.push({
                cr: contractCode,
                name:
                  contractName ||
                  `CR ${contractCode}`
              });
            } else if (
              contractName &&
              contractResult.rows[0].name !==
                contractName
            ) {
              /*
               * Atualiza o nome do contrato
               * caso o CR já exista.
               */

              await pool.query(
                `
                UPDATE contracts
                SET
                  name = $1,
                  active = TRUE
                WHERE id = $2
                `,
                [
                  contractName,
                  contractResult.rows[0].id
                ]
              );
            }

            contractId =
              contractResult.rows[0].id;
          }

          /* =====================================
             HORÁRIO
             ===================================== */

          const schedule = getValue(row, [
            "HORARIO CONTRATO",
            "HORÁRIO CONTRATO",
            "HORARIO",
            "HORÁRIO",
            "ESCALA",
            "JORNADA",
            "SCHEDULE"
          ]);

          /*
           * Exemplos aceitos:
           *
           * 10:00#15:00#16:00#22:00
           * 07:00#12:00#13:00#19:00
           * FOLGA
           */

          /* =====================================
             OUTROS CAMPOS OPCIONAIS
             ===================================== */

          const phoneRaw = getValue(row, [
            "TELEFONE",
            "WHATSAPP",
            "CELULAR",
            "PHONE"
          ]);

          const phone = phoneRaw
            ? normalizePhone(phoneRaw)
            : null;

          const role = getValue(row, [
            "POSTO",
            "FUNCAO",
            "FUNÇÃO",
            "CARGO",
            "ROLE"
          ]) || null;

          const shiftRaw = getValue(row, [
            "TURNO",
            "PAR/IMPAR",
            "PAR/ÍMPAR",
            "ESCALA PAR IMPAR",
            "SHIFT"
          ]);

          const shift = shiftRaw
            ? normalizeShift(shiftRaw)
            : null;

          /* =====================================
             VERIFICA MATRÍCULA
             ===================================== */

          const existing =
            await pool.query(
              `
              SELECT
                id,
                contract_id
              FROM employees
              WHERE registration = $1
              LIMIT 1
              `,
              [registration]
            );

          if (existing.rows[0]) {
            /*
             * MATRÍCULA JÁ EXISTE:
             * atualiza o cadastro.
             *
             * Isso também permite identificar
             * transferência entre CRs.
             */

            await pool.query(
              `
              UPDATE employees
              SET
                name = $1,
                phone =
                  COALESCE($2, phone),
                contract_id =
                  COALESCE($3, contract_id),
                role =
                  COALESCE($4, role),
                shift =
                  COALESCE($5, shift),
                schedule =
                  COALESCE($6, schedule),
                active = TRUE,
                updated_at = NOW()
              WHERE registration = $7
              `,
              [
                employeeName,
                phone,
                contractId,
                role,
                shift,
                schedule || null,
                registration
              ]
            );

            updated++;
          } else {
            /*
             * NOVO COLABORADOR
             */

            await pool.query(
              `
              INSERT INTO employees
              (
                registration,
                name,
                phone,
                contract_id,
                role,
                shift,
                schedule,
                active
              )
              VALUES
              (
                $1,
                $2,
                $3,
                $4,
                $5,
                $6,
                $7,
                TRUE
              )
              `,
              [
                registration,
                employeeName,
                phone,
                contractId,
                role,
                shift,
                schedule || null
              ]
            );

            imported++;
          }
        } catch (rowError) {
          console.error(
            `Erro na linha ${i + 2}:`,
            rowError
          );

          skipped++;

          errors.push({
            row: i + 2,
            error:
              rowError.message ||
              "Erro ao processar colaborador."
          });
        }
      }

      /* -----------------------------------------
         RESULTADO DA IMPORTAÇÃO
         ----------------------------------------- */

      res.json({
        ok: true,

        message:
          "Planilha processada com sucesso.",

        total: rows.length,

        imported,
        updated,
        skipped,

        createdContracts,

        errors: errors.slice(0, 50)
      });
    } catch (error) {
      console.error(
        "Erro na importação de colaboradores:",
        error
      );

      res.status(500).json({
        error:
          "Não foi possível importar a planilha.",
        details: error.message
      });
    }
  }
);

/* =========================================================
   HORAS EXTRAS
========================================================= */

app.get(
  "/api/overtime",
  auth,
  async (req, res) => {
    const result = await pool.query(`
      SELECT
        o.*,
        e.name AS employee_name,
        e.registration,
        c.name AS contract_name
      FROM overtime o
      JOIN employees e
        ON e.id=o.employee_id
      LEFT JOIN contracts c
        ON c.id=e.contract_id
      ORDER BY
        o.work_date DESC,
        e.name
      LIMIT 1000
    `);

    res.json(result.rows);
  }
);

app.post(
  "/api/overtime",
  auth,
  async (req, res) => {
    const {
      employee_id,
      work_date,
      hours,
      description
    } = req.body;

    if (
      !employee_id ||
      !work_date ||
      hours === undefined
    ) {
      return res.status(400).json({
        error:
          "Informe colaborador, data e horas."
      });
    }

    const result = await pool.query(
      `
      INSERT INTO overtime
        (
          employee_id,
          work_date,
          hours,
          description
        )
      VALUES ($1,$2,$3,$4)
      RETURNING *
      `,
      [
        employee_id,
        work_date,
        hours,
        description || null
      ]
    );

    res.status(201).json(
      result.rows[0]
    );
  }
);

app.post(
  "/api/import/overtime",
  auth,
  upload.single("file"),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({
        error:
          "Selecione uma planilha."
      });
    }

    try {
      const workbook =
        XLSX.read(req.file.buffer, {
          type: "buffer"
        });

      const sheet =
        workbook.Sheets[
          workbook.SheetNames[0]
        ];

      const rows =
        XLSX.utils.sheet_to_json(
          sheet,
          { defval: "" }
        );

      let imported = 0;
      let skipped = 0;

      for (const row of rows) {
        const registration =
          firstValue(row, [
            "Matrícula",
            "Matricula",
            "MATRICULA"
          ]);

        const date = excelDate(
          firstValue(row, [
            "Data",
            "DATA"
          ])
        );

        const hours =
          Number(
            firstValue(row, [
              "Horas Extras",
              "Horas",
              "HE",
              "HORAS"
            ])
          );

        if (
          !registration ||
          !date ||
          Number.isNaN(hours)
        ) {
          skipped++;
          continue;
        }

        const employee =
          await pool.query(
            `
            SELECT id
            FROM employees
            WHERE registration=$1
            `,
            [
              String(
                registration
              ).trim()
            ]
          );

        if (!employee.rows[0]) {
          skipped++;
          continue;
        }

        await pool.query(
          `
          INSERT INTO overtime
            (
              employee_id,
              work_date,
              hours
            )
          VALUES ($1,$2,$3)
          `,
          [
            employee.rows[0].id,
            date,
            hours
          ]
        );

        imported++;
      }

      res.json({
        ok: true,
        total: rows.length,
        imported,
        skipped
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error:
          "Erro ao importar horas extras."
      });
    }
  }
);

/* =========================================================
   COBERTURAS IA
========================================================= */

app.get(
  "/api/coverages",
  auth,
  async (req, res) => {
    const result = await pool.query(`
      SELECT
        cv.*,
        c.name AS contract_name,
        c.cr,
        p.name AS post_name,
        absent.name AS absent_name,
        selected.name AS selected_name
      FROM coverages cv
      LEFT JOIN contracts c
        ON c.id=cv.contract_id
      LEFT JOIN posts p
        ON p.id=cv.post_id
      LEFT JOIN employees absent
        ON absent.id=
          cv.absent_employee_id
      LEFT JOIN employees selected
        ON selected.id=
          cv.selected_employee_id
      ORDER BY
        cv.coverage_date DESC,
        cv.created_at DESC
      LIMIT 500
    `);

    res.json(result.rows);
  }
);

app.post(
  "/api/coverages",
  auth,
  async (req, res) => {
    try {
      const {
        contract_id,
        post_id,
        absent_employee_id,
        coverage_date,
        shift,
        reason
      } = req.body;

      if (
        !contract_id ||
        !coverage_date
      ) {
        return res.status(400).json({
          error:
            "Informe contrato e data da cobertura."
        });
      }

      let absentShift =
        normalizeShift(shift);

      if (
        absent_employee_id &&
        !absentShift
      ) {
        const absent =
          await pool.query(
            `
            SELECT shift
            FROM employees
            WHERE id=$1
            `,
            [absent_employee_id]
          );

        absentShift =
          normalizeShift(
            absent.rows[0]?.shift
          );
      }

      const wantedShift =
        oppositeShift(absentShift);

      const created =
        await pool.query(
          `
          INSERT INTO coverages
            (
              contract_id,
              post_id,
              absent_employee_id,
              coverage_date,
              shift,
              reason,
              created_by
            )
          VALUES
            ($1,$2,$3,$4,$5,$6,$7)
          RETURNING *
          `,
          [
            contract_id,
            post_id || null,
            absent_employee_id || null,
            coverage_date,
            absentShift || shift || null,
            reason || null,
            req.user.id
          ]
        );

      const coverage =
        created.rows[0];

      const candidates =
        await pool.query(
          `
          SELECT
            e.id,
            e.name,
            e.phone,
            e.registration,
            e.contract_id,
            e.post_id,
            e.role,
            e.shift,
            e.schedule,

            COALESCE(
              (
                SELECT SUM(o.hours)
                FROM overtime o
                WHERE
                  o.employee_id=e.id
                  AND
                  o.work_date >=
                    CURRENT_DATE -
                    INTERVAL '90 days'
              ),
              0
            )::float AS overtime_90d,

            COALESCE(
              (
                SELECT COUNT(*)
                FROM coverages c2
                WHERE
                  c2.selected_employee_id=e.id
                  AND
                  c2.status='CONFIRMADA'
                  AND
                  c2.coverage_date >=
                    CURRENT_DATE -
                    INTERVAL '90 days'
              ),
              0
            )::int AS coverages_90d

          FROM employees e

          WHERE
            e.active=TRUE

            AND
            (
              $1::int IS NULL
              OR e.id<>$1
            )

            AND
            (
              $2::text IS NULL
              OR
              UPPER(
                COALESCE(
                  e.shift,
                  ''
                )
              )=$2
            )

          ORDER BY e.name
          `,
          [
            absent_employee_id || null,
            wantedShift || null
          ]
        );

      const ranked =
        candidates.rows
          .map(candidate => {
            let score = 0;

            if (
              Number(
                candidate.contract_id
              ) ===
              Number(contract_id)
            ) {
              score += 100;
            }

            if (
              post_id &&
              Number(
                candidate.post_id
              ) ===
              Number(post_id)
            ) {
              score += 25;
            }

            /*
              Quanto menos horas extras
              recentes, maior a pontuação.
              Isso evita concentração.
            */
            score -=
              Number(
                candidate.overtime_90d ||
                0
              ) * 2;

            score -=
              Number(
                candidate.coverages_90d ||
                0
              ) * 3;

            if (candidate.phone) {
              score += 5;
            }

            return {
              ...candidate,
              score
            };
          })
          .sort(
            (a, b) =>
              b.score - a.score
          );

      for (
        let index = 0;
        index < ranked.length;
        index++
      ) {
        await pool.query(
          `
          INSERT INTO coverage_candidates
            (
              coverage_id,
              employee_id,
              score,
              position
            )
          VALUES ($1,$2,$3,$4)
          ON CONFLICT
            (coverage_id,employee_id)
          DO NOTHING
          `,
          [
            coverage.id,
            ranked[index].id,
            ranked[index].score,
            index + 1
          ]
        );
      }

      res.status(201).json({
        coverage,
        oppositeShift:
          wantedShift,
        candidates: ranked
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error:
          "Erro ao gerar cobertura."
      });
    }
  }
);

app.get(
  "/api/coverages/:id/candidates",
  auth,
  async (req, res) => {
    const result = await pool.query(
      `
      SELECT
        cc.*,
        e.name,
        e.phone,
        e.registration,
        e.role,
        e.shift,
        e.schedule,
        c.name AS contract_name,
        p.name AS post_name
      FROM coverage_candidates cc
      JOIN employees e
        ON e.id=cc.employee_id
      LEFT JOIN contracts c
        ON c.id=e.contract_id
      LEFT JOIN posts p
        ON p.id=e.post_id
      WHERE cc.coverage_id=$1
      ORDER BY cc.position
      `,
      [req.params.id]
    );

    res.json(result.rows);
  }
);

app.post(
  "/api/coverages/:id/contact/:employeeId",
  auth,
  async (req, res) => {
    const result = await pool.query(
      `
      UPDATE coverage_candidates
      SET
        status='MENSAGEM_ENVIADA',
        contacted_at=NOW()
      WHERE
        coverage_id=$1
        AND employee_id=$2
        AND status='PENDENTE'
        AND EXISTS (
          SELECT 1
          FROM coverages
          WHERE id=$1
            AND status='ABERTA'
        )
      RETURNING *
      `,
      [
        req.params.id,
        req.params.employeeId
      ]
    );

    if (!result.rows[0]) {
      return res.status(409).json({
        error: "Este candidato já foi contatado ou a cobertura não está mais aberta."
      });
    }

    res.json(result.rows[0]);
  }
);

app.post(
  "/api/coverages/:id/confirm/:employeeId",
  auth,
  async (req, res) => {
    const client =
      await pool.connect();

    try {
      await client.query("BEGIN");

      await client.query(
        `
        UPDATE coverages
        SET
          selected_employee_id=$1,
          status='CONFIRMADA',
          confirmed_at=NOW()
        WHERE id=$2
        `,
        [
          req.params.employeeId,
          req.params.id
        ]
      );

      await client.query(
        `
        UPDATE coverage_candidates
        SET
          status=
            CASE
              WHEN employee_id=$1
              THEN 'CONFIRMADO'
              ELSE 'CANCELADO'
            END,
          responded_at=
            CASE
              WHEN employee_id=$1
              THEN NOW()
              ELSE responded_at
            END
        WHERE coverage_id=$2
        `,
        [
          req.params.employeeId,
          req.params.id
        ]
      );

      await client.query("COMMIT");

      res.json({ ok: true });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
);

/* =========================================================
   SOLICITAÇÕES / PENDÊNCIAS
========================================================= */

app.get(
  "/api/requests",
  auth,
  async (req, res) => {
    const result = await pool.query(`
      SELECT
        r.*,
        e.name AS employee_name,
        e.registration,
        e.phone,
        c.name AS contract_name
      FROM requests r
      JOIN employees e
        ON e.id=r.employee_id
      LEFT JOIN contracts c
        ON c.id=r.contract_id
      ORDER BY
        CASE
          WHEN r.status='PENDENTE'
          THEN 0
          ELSE 1
        END,
        r.created_at DESC
      LIMIT 1000
    `);

    res.json(result.rows);
  }
);

app.post(
  "/api/requests",
  auth,
  async (req, res) => {
    const {
      employee_ids,
      type,
      reference,
      message
    } = req.body;

    if (
      !Array.isArray(employee_ids) ||
      !employee_ids.length ||
      !type
    ) {
      return res.status(400).json({
        error:
          "Selecione colaboradores e tipo da solicitação."
      });
    }

    const created = [];

    for (const employeeId of employee_ids) {
      const employee =
        await pool.query(
          `
          SELECT
            id,
            contract_id
          FROM employees
          WHERE id=$1
          `,
          [employeeId]
        );

      if (!employee.rows[0]) continue;

      const result =
        await pool.query(
          `
          INSERT INTO requests
            (
              employee_id,
              contract_id,
              type,
              reference,
              message
            )
          VALUES ($1,$2,$3,$4,$5)
          RETURNING *
          `,
          [
            employeeId,
            employee.rows[0]
              .contract_id,
            type,
            reference || null,
            message || null
          ]
        );

      created.push(
        result.rows[0]
      );
    }

    res.status(201).json({
      created: created.length,
      items: created
    });
  }
);

app.put(
  "/api/requests/:id/status",
  auth,
  async (req, res) => {
    const status =
      String(
        req.body.status || ""
      ).toUpperCase();

    const allowed = [
      "PENDENTE",
      "MENSAGEM_ENVIADA",
      "ASSINADO",
      "CONCLUIDO",
      "CANCELADO"
    ];

    if (!allowed.includes(status)) {
      return res.status(400).json({
        error: "Status inválido."
      });
    }

    const result = await pool.query(
      `
      UPDATE requests
      SET
        status=$1,
        sent_at=
          CASE
            WHEN $1='MENSAGEM_ENVIADA'
            THEN COALESCE(
              sent_at,
              NOW()
            )
            ELSE sent_at
          END,
        completed_at=
          CASE
            WHEN $1 IN (
              'ASSINADO',
              'CONCLUIDO'
            )
            THEN NOW()
            ELSE completed_at
          END
      WHERE id=$2
      RETURNING *
      `,
      [
        status,
        req.params.id
      ]
    );

    res.json(result.rows[0]);
  }
);

/* =========================================================
   WHATSAPP
========================================================= */

app.post(
  "/api/whatsapp/message",
  auth,
  async (req, res) => {
    const phone =
      normalizePhone(req.body.phone);

    const message =
      String(
        req.body.message || ""
      ).trim();

    if (!phone || !message) {
      return res.status(400).json({
        error:
          "Informe telefone e mensagem."
      });
    }

    const url =
      `https://wa.me/${phone}` +
      `?text=${encodeURIComponent(
        message
      )}`;

    res.json({ url });
  }
);

/* =========================================================
   USUÁRIOS / ADMINISTRAÇÃO
========================================================= */

app.get(
  "/api/users",
  auth,
  adminOnly,
  async (req, res) => {
    const result = await pool.query(`
      SELECT
        id,
        name,
        email,
        role,
        active,
        created_at
      FROM users
      ORDER BY name
    `);

    res.json(result.rows);
  }
);

app.post(
  "/api/users",
  auth,
  adminOnly,
  async (req, res) => {
    const {
      name,
      email,
      password,
      role
    } = req.body;

    const allowedRoles = [
      "ADM",
      "COORDENADOR",
      "SUPERVISOR"
    ];

    if (
      !name ||
      !email ||
      !password ||
      password.length < 8 ||
      !allowedRoles.includes(role)
    ) {
      return res.status(400).json({
        error:
          "Dados do usuário inválidos."
      });
    }

    try {
      const hash =
        await bcrypt.hash(
          password,
          12
        );

      const result =
        await pool.query(
          `
          INSERT INTO users
            (
              name,
              email,
              password_hash,
              role
            )
          VALUES ($1,$2,$3,$4)
          RETURNING
            id,
            name,
            email,
            role,
            active
          `,
          [
            name.trim(),
            email
              .trim()
              .toLowerCase(),
            hash,
            role
          ]
        );

      res.status(201).json(
        result.rows[0]
      );
    } catch (error) {
      if (error.code === "23505") {
        return res.status(409).json({
          error:
            "Este e-mail já está cadastrado."
        });
      }

      throw error;
    }
  }
);

app.put(
  "/api/users/:id",
  auth,
  adminOnly,
  async (req, res) => {
    const {
      name,
      role,
      active
    } = req.body;

    const result = await pool.query(
      `
      UPDATE users
      SET
        name=COALESCE($1,name),
        role=COALESCE($2,role),
        active=COALESCE($3,active)
      WHERE id=$4
      RETURNING
        id,
        name,
        email,
        role,
        active
      `,
      [
        name || null,
        role || null,
        active === undefined
          ? null
          : active,
        req.params.id
      ]
    );

    res.json(result.rows[0]);
  }
);

app.put(
  "/api/users/:id/contracts",
  auth,
  adminOnly,
  async (req, res) => {
    const contractIds =
      Array.isArray(
        req.body.contract_ids
      )
        ? req.body.contract_ids
        : [];

    const client =
      await pool.connect();

    try {
      await client.query("BEGIN");

      await client.query(
        `
        DELETE FROM user_contracts
        WHERE user_id=$1
        `,
        [req.params.id]
      );

      for (
        const contractId
        of contractIds
      ) {
        await client.query(
          `
          INSERT INTO user_contracts
            (user_id,contract_id)
          VALUES ($1,$2)
          ON CONFLICT DO NOTHING
          `,
          [
            req.params.id,
            contractId
          ]
        );
      }

      await client.query("COMMIT");

      res.json({ ok: true });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
);

/* =========================================================
   RELATÓRIOS
========================================================= */

app.get(
  "/api/reports/overtime",
  auth,
  async (req, res) => {
    const result = await pool.query(`
      SELECT
        e.id,
        e.registration,
        e.name,
        c.name AS contract_name,
        COALESCE(
          SUM(o.hours),
          0
        )::float AS total_hours,
        COUNT(o.id)::int AS records
      FROM employees e
      LEFT JOIN contracts c
        ON c.id=e.contract_id
      LEFT JOIN overtime o
        ON o.employee_id=e.id
      GROUP BY
        e.id,
        c.name
      ORDER BY
        total_hours DESC,
        e.name
    `);

    res.json(result.rows);
  }
);

app.get(
  "/api/reports/contracts",
  auth,
  async (req, res) => {
    const result = await pool.query(`
      SELECT
        c.id,
        c.cr,
        c.name,

        COUNT(
          DISTINCT e.id
        )::int AS employees,

        COUNT(
          DISTINCT p.id
        )::int AS posts,

        COALESCE(
          SUM(o.hours),
          0
        )::float AS overtime_hours

      FROM contracts c

      LEFT JOIN employees e
        ON e.contract_id=c.id
        AND e.active=TRUE

      LEFT JOIN posts p
        ON p.contract_id=c.id
        AND p.active=TRUE

      LEFT JOIN overtime o
        ON o.employee_id=e.id

      GROUP BY c.id

      ORDER BY c.name
    `);

    res.json(result.rows);
  }
);

/* =========================================================
   ERROS DE API
========================================================= */

app.use("/api", (req, res) => {
  res.status(404).json({
    error: "Rota não encontrada."
  });
});

/* =========================================================
   FRONT-END
========================================================= */

app.get("*", (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );
});

/* =========================================================
   INICIALIZAÇÃO
========================================================= */

init()
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(
        `OPERA IA rodando na porta ${PORT}`
      );
    });
  })
  .catch(error => {
    console.error(
      "Falha ao inicializar OPERA IA:",
      error
    );

    process.exit(1);
  });

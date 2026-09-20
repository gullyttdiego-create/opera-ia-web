# OPERA IA Web
**A inteligência que conecta pessoas às operações.**

Sistema web responsivo e PWA instalável para gestão de contratos/CR, colaboradores, coberturas, horas extras e pendências operacionais.

## Executar
1. `npm install`
2. Configure `DATABASE_URL` (PostgreSQL) se desejar persistência.
3. `npm start`
4. Abra `http://localhost:3000`

## Validação

- `npm test`: verifica a sintaxe do servidor, da interface, do service worker e os recursos obrigatórios do PWA.
- No Android, abra a URL HTTPS no Chrome e use **Instalar app** quando a opção aparecer.

O service worker armazena apenas os arquivos da interface. As rotas `/api` e os dados do PostgreSQL continuam sendo consultados diretamente no servidor.

## Railway
O projeto usa `PORT` automaticamente e está pronto para deploy Node.js. Configure `DATABASE_URL` no serviço web.

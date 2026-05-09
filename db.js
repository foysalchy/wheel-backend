const mysql = require("mysql2");

const db = mysql.createConnection({
  host: "209.42.27.91",
  user: "microlab_api",
  password: "microlab_api",
  database: "microlab_api",
  port: 3306,
  waitForConnections: true,
  connectionLimit: 10,
});

// const db = mysql.createConnection({
//   host: "localhost",
//   user: "root",
//   password: "",
//   database: "wheel",
//   port: 3306,
//   waitForConnections: true,
//   connectionLimit: 10,
// });

db.connect((err) => {
  if (err) {
    console.log("DB Error:", err);
  } else {
    console.log("MySQL Connected");
  }
});

module.exports = db;
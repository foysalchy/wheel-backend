const mysql = require("mysql2");

const db = mysql.createConnection({
  host: "103.163.246.85",
  user: "finixcom_wheel",
  password: "finixcom_wheel",
  database: "finixcom_wheel",
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
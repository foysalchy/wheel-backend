const mysql = require("mysql2");

const db = mysql.createConnection({
  host: "103.163.246.85",
  user: "finixcom_wheel",
  password: "finixcom_wheel",
  database: "wheel",
});

db.connect((err) => {
  if (err) {
    console.log("DB Error:", err);
  } else {
    console.log("MySQL Connected");
  }
});

module.exports = db;
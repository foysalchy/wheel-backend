const mysql = require("mysql2");

const db = mysql.createPool({
  host: "103.163.246.85",
  user: "finixcom_whlive",
  password: "finixcom_whlive",
  database: "finixcom_whlive",
  port: 3306,
  waitForConnections: true,
  connectionLimit: 10,
  connectTimeout: 10000,
});

// console.log(db, "db config test");

module.exports = db.promise();
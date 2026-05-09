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
db.getConnection((err, conn) => {
  if (err) {
    console.log("DB Error:", err);
    return;
  }
  console.log("DB Pool Connected");
  conn.release();
});
 

module.exports = db.promise();
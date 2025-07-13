const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const fs = require("fs");
const path = require("path");
const bodyParser = require("body-parser");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = 3000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

const USERS_FILE = path.join(__dirname, "users.json");
const ORDERS_FILE = path.join(__dirname, "orders.json");
const RATINGS_FILE = path.join(__dirname, "ratings.json");

if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, "[]", "utf8");
if (!fs.existsSync(ORDERS_FILE)) fs.writeFileSync(ORDERS_FILE, "[]", "utf8");
if (!fs.existsSync(RATINGS_FILE)) fs.writeFileSync(RATINGS_FILE, "[]", "utf8");

function loadUsers() {
  return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
}
function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf8");
}
function loadOrders() {
  return JSON.parse(fs.readFileSync(ORDERS_FILE, "utf8"));
}
function saveOrders(orders) {
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2), "utf8");
}
function loadRatings() {
  return JSON.parse(fs.readFileSync(RATINGS_FILE, "utf8"));
}
function saveRatings(ratings) {
  fs.writeFileSync(RATINGS_FILE, JSON.stringify(ratings, null, 2), "utf8");
}

// ✅ تسجيل السائق
app.post("/register-driver", (req, res) => {
  const { name, phone, password, vehicle, isSigResident } = req.body;
  const users = loadUsers();

  if (isSigResident !== "yes") return res.send("🚫 الخدمة متوفرة فقط لسكان مدينة سيق.");
  if (users.some(u => u.phone === phone)) return res.send("📛 هذا الرقم مسجل مسبقًا.");

  users.push({
    role: "driver",
    name,
    phone,
    password,
    vehicle,
    isSigResident,
    startDate: new Date().toISOString(),
    status: "available",
    isActive: true,
    lat: 35.9399,
    lon: 0.0917
  });

  saveUsers(users);
  res.redirect(`/driver-dashboard.html?phone=${phone}`);
});

// ✅ تسجيل الزبون
app.post("/register-client", (req, res) => {
  const { name, phone, password, isSigResident } = req.body;
  const users = loadUsers();

  if (isSigResident !== "yes") return res.send("🚫 الخدمة متوفرة فقط لسكان مدينة سيق.");
  if (users.find(u => u.phone === phone)) return res.send("📛 رقم الهاتف مسجل من قبل.");

  users.push({
    role: "client",
    name,
    phone,
    password,
    isSigResident,
    startDate: new Date().toISOString(),
    isActive: true
  });

  saveUsers(users);
  res.redirect(`/client.html?phone=${phone}`);
});

// ✅ تسجيل الدخول
app.post("/login", (req, res) => {
  const { phone, password } = req.body;
  const users = loadUsers();
  const user = users.find(u => u.phone === phone && u.password === password);
  if (!user) return res.send("❌ معلومات الدخول غير صحيحة.");

  const startDate = new Date(user.startDate);
  const now = new Date();
  const diffDays = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));

  if (diffDays > 30) return res.send("🔒 انتهت صلاحية اشتراكك المجاني. يرجى التجديد.");
  res.send(`✅ ${user.role} ${user.name}`);
});

// ✅ تحديث حالة السائق
app.post("/update-status", (req, res) => {
  const { phone, status } = req.body;
  const users = loadUsers();
  const driver = users.find(u => u.phone === phone && u.role === "driver");
  if (!driver) return res.send("❌ السائق غير موجود");

  driver.status = status;

  if (status === "offline") {
    delete driver.lat;
    delete driver.lon;
  }

  saveUsers(users);
  res.send("✅ تم تحديث حالتك إلى: " + status);
});

// ✅ جلب السائقين المتاحين فقط
app.get("/available-drivers", (req, res) => {
  const users = loadUsers();
  const drivers = users.filter(u =>
    u.role === "driver" &&
    u.status === "available" &&
    u.lat && u.lon
  );
  res.json(drivers);
});

// ✅ جلب اسم المستخدم
app.get("/get-name-by-phone", (req, res) => {
  const phone = req.query.phone;
  const users = loadUsers();
  const user = users.find(u => u.phone === phone);
  if (!user) return res.json({ name: "مستخدم مجهول" });
  res.json({ name: user.name });
});

// ✅ إرسال الطلب
app.post("/send-order", (req, res) => {
  const { client, driver, from, to, note } = req.body;
  const orders = loadOrders();

  const newOrder = {
    id: Date.now(),
    client,
    driver,
    from,
    to,
    note,
    status: "pending",
    time: new Date().toISOString()
  };

  orders.push(newOrder);
  saveOrders(orders);
  res.send("✅ تم إرسال الطلب بنجاح!");
});

// ✅ جلب الطلبات المفتوحة
app.get("/my-orders", (req, res) => {
  const orders = loadOrders();
  const myOrders = orders.filter(o => o.status === "pending");
  res.json(myOrders);
});

// ✅ قبول الطلب
app.post("/accept-order", (req, res) => {
  const { id } = req.body;
  const orders = loadOrders();
  const order = orders.find(o => o.id == id);
  if (!order) return res.send("❌ الطلب غير موجود");

  order.status = "accepted";
  saveOrders(orders);

  io.to(`${order.client}-${order.driver}`).emit("orderAccepted", {
    driver: order.driver,
    orderId: order.id
  });

  res.send("✅ تم قبول الطلب.");
});

// ✅ رفض الطلب
app.post("/reject-order", (req, res) => {
  const { id } = req.body;
  const orders = loadOrders();
  const order = orders.find(o => o.id == id);
  if (!order) return res.send("❌ الطلب غير موجود");

  order.status = "rejected";
  saveOrders(orders);

  io.to(`${order.client}-${order.driver}`).emit("orderRejected", {
    driver: order.driver,
    orderId: order.id
  });

  res.send("❌ تم رفض الطلب.");
});

// ✅ تقييم
app.post("/submit-rating", (req, res) => {
  const { client, driver, rating, comment } = req.body;
  const ratings = loadRatings();

  ratings.push({ client, driver, rating, comment, time: new Date().toISOString() });
  saveRatings(ratings);
  res.send("✅ شكراً لتقييمك!");
});

// ✅ تحديث موقع المستخدم
app.post("/update-location", (req, res) => {
  const { phone, lat, lon } = req.body;
  const users = loadUsers();
  const user = users.find(u => u.phone === phone);
  if (!user) return res.send("❌ المستخدم غير موجود");

  user.lat = lat;
  user.lon = lon;
  saveUsers(users);
  res.send("✅ تم تحديث الموقع");
});

// ✅ جلب موقع الزبون
app.get("/get-client-location", (req, res) => {
  const phone = req.query.phone;
  const users = loadUsers();
  const client = users.find(u => u.phone === phone && u.role === "client");
  if (!client) return res.json({});
  res.json({ lat: client.lat, lon: client.lon });
});

// ✅ WebSocket للدردشة
io.on("connection", (socket) => {
  console.log("💬 مستخدم متصل");

  socket.on("joinRoom", (roomId) => {
    socket.join(roomId);
    console.log(`👥 انضم للغرفة: ${roomId}`);
  });

  socket.on("chat message", ({ roomId, sender, message, timestamp }) => {
    io.to(roomId).emit("chat message", { sender, message, timestamp });
  });

  socket.on("disconnect", () => {
    console.log("❌ مستخدم خرج من الدردشة");
  });
});

// ✅ إدارة المستخدمين
app.get("/all-users", (req, res) => {
  const users = loadUsers();
  res.json(users);
});

app.post("/delete-user", (req, res) => {
  const { phone } = req.body;
  let users = loadUsers();
  users = users.filter(u => u.phone !== phone);
  saveUsers(users);
  res.send("✅ تم حذف المستخدم");
});

app.get("/ratings", (req, res) => {
  const ratings = loadRatings();
  res.json(ratings);
});

// ✅ تشغيل الخادم
server.listen(PORT, () => {
  console.log(`🚀 الخادم يعمل على http://localhost:${PORT}`);
});

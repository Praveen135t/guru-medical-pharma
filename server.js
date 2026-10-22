const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const path = require("path");

if (!process.env.ADMIN_PASSWORD) {
  console.error("Set ADMIN_PASSWORD in Replit Secrets before starting.");
  process.exit(1);
}
if (!process.env.SESSION_SECRET) {
  console.error("Set SESSION_SECRET in Replit Secrets before starting.");
  process.exit(1);
}

const app = express();
const db = new Database("guru-medical.db");
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS products (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'General',
 description TEXT NOT NULL DEFAULT '', price REAL NOT NULL CHECK(price >= 0),
 stock INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0),
 image TEXT NOT NULL DEFAULT '', prescription_required INTEGER NOT NULL DEFAULT 0,
 active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS orders (
 id INTEGER PRIMARY KEY AUTOINCREMENT, order_no TEXT UNIQUE NOT NULL,
 customer_name TEXT NOT NULL, phone TEXT NOT NULL, items_json TEXT NOT NULL,
 total REAL NOT NULL, payment_method TEXT NOT NULL, payment_status TEXT NOT NULL DEFAULT 'Pending',
 status TEXT NOT NULL DEFAULT 'Pending', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS settings (
 key TEXT PRIMARY KEY, value TEXT NOT NULL
);
`);
const settingDefaults = {
 shop_name: "Guru Medical & Pharma Clinic",
 shop_name_hi: "गुरु मेडिकल & फार्मा क्लिनिक",
 shop_address: "Shop No. 1, Kuriya Lawayan, Sharma Market, Marg, Prayagraj, Barika, Uttar Pradesh 211010",
 shop_hours: "24 hours",
 shop_lat: process.env.SHOP_LAT || "",
 shop_lng: process.env.SHOP_LNG || "",
 low_stock_threshold: "5"
};
const insSetting = db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)");
Object.entries(settingDefaults).forEach(([k,v])=>insSetting.run(k,v));

app.use(express.json({limit:"1mb"}));
app.use(express.urlencoded({extended:true}));
app.use(session({
 secret: process.env.SESSION_SECRET,
 resave: false, saveUninitialized: false,
 cookie: { httpOnly:true, sameSite:"lax", secure: process.env.NODE_ENV === "production", maxAge: 8*60*60*1000 }
}));
app.use(express.static(path.join(__dirname, "public")));

const adminHash = bcrypt.hashSync(process.env.ADMIN_PASSWORD, 12);
const adminOnly = (req,res,next) => req.session && req.session.admin ? next() : res.status(401).json({error:"Admin login required."});
const getSettings = () => Object.fromEntries(db.prepare("SELECT key,value FROM settings").all().map(x=>[x.key,x.value]));
const publicProduct = p => ({id:p.id,name:p.name,category:p.category,description:p.description,price:p.price,stock:p.stock,image:p.image,prescriptionRequired:!!p.prescription_required});
const statusValues = ["Pending","Confirmed","Preparing","Ready for Pickup","Completed","Cancelled"];

app.get("/api/shop", (req,res) => {
 const s=getSettings();
 res.json({name:s.shop_name,nameHi:s.shop_name_hi,address:s.shop_address,hours:s.shop_hours,lat:s.shop_lat,lng:s.shop_lng,open:true});
});
app.get("/api/products", (req,res) => {
 const q=String(req.query.q||"").trim();
 const rows=q
  ? db.prepare("SELECT * FROM products WHERE active=1 AND (name LIKE ? OR category LIKE ? OR description LIKE ?) ORDER BY name").all(`%${q}%`,`%${q}%`,`%${q}%`)
  : db.prepare("SELECT * FROM products WHERE active=1 ORDER BY name").all();
 res.json(rows.map(publicProduct));
});
app.post("/api/orders", (req,res) => {
 const {name,phone,items,paymentMethod}=req.body||{};
 if(!String(name||"").trim() || !/^[0-9+\-\s]{8,16}$/.test(String(phone||"")) || !Array.isArray(items) || !items.length)
  return res.status(400).json({error:"Enter your name, a valid phone number and at least one item."});
 if(!["pay_at_shop","online"].includes(paymentMethod)) return res.status(400).json({error:"Choose a valid payment method."});
 if(paymentMethod==="online") return res.status(501).json({error:"Online payment is not configured yet. Choose Pay at Shop, or configure and verify a payment gateway before enabling online payments."});
 const tx=db.transaction(()=>{
  let total=0; const finalItems=[];
  for(const item of items){
   const id=Number(item.id), qty=Number(item.qty);
   if(!Number.isInteger(id)||!Number.isInteger(qty)||qty<1||qty>50) throw new Error("Invalid product or quantity.");
   const p=db.prepare("SELECT * FROM products WHERE id=? AND active=1").get(id);
   if(!p) throw new Error("A selected product is unavailable.");
   if(p.prescription_required) throw new Error(`"${p.name}" requires prescription review by pharmacy staff. Please contact the shop.`);
   if(p.stock<qty) throw new Error(`Only ${p.stock} unit(s) of "${p.name}" are currently available.`);
   total += p.price*qty;
   finalItems.push({id:p.id,name:p.name,price:p.price,qty});
  }
  const orderNo="GMP-"+Date.now().toString(36).toUpperCase()+"-"+Math.random().toString(36).slice(2,6).toUpperCase();
  db.prepare("INSERT INTO orders(order_no,customer_name,phone,items_json,total,payment_method,payment_status,status) VALUES(?,?,?,?,?,?,?,?)")
   .run(orderNo,String(name).trim(),String(phone).trim(),JSON.stringify(finalItems),Math.round(total*100)/100,"pay_at_shop","Pending","Pending");
  for(const item of finalItems) db.prepare("UPDATE products SET stock=stock-? WHERE id=?").run(item.qty,item.id);
  return {orderNo,total:Math.round(total*100)/100};
 });
 try { res.status(201).json(tx()); } catch(e) { res.status(400).json({error:e.message||"Unable to place order."}); }
});
app.get("/api/orders/track", (req,res) => {
 const orderNo=String(req.query.orderNo||"").trim(), phone=String(req.query.phone||"").trim();
 if(!orderNo||!phone) return res.status(400).json({error:"Order number and phone number are required."});
 const o=db.prepare("SELECT order_no,customer_name,items_json,total,payment_method,payment_status,status,created_at FROM orders WHERE order_no=? AND phone=?").get(orderNo,phone);
 if(!o) return res.status(404).json({error:"Order not found. Check the order number and phone number."});
 res.json({...o,items:JSON.parse(o.items_json),items_json:undefined});
});
app.post("/api/admin/login", async (req,res)=>{
 const {username,password}=req.body||{};
 if(username!=="admin" || typeof password!=="string" || !bcrypt.compareSync(password,adminHash))
  return res.status(401).json({error:"Incorrect username or password."});
 req.session.admin=true; res.json({ok:true});
});
app.post("/api/admin/logout",adminOnly,(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get("/api/admin/me",(req,res)=>res.json({loggedIn:!!(req.session&&req.session.admin)}));
app.get("/api/admin/summary",adminOnly,(req,res)=>{
 const s=getSettings(), products=db.prepare("SELECT * FROM products ORDER BY name").all();
 const orders=db.prepare("SELECT * FROM orders ORDER BY id DESC LIMIT 100").all();
 res.json({
  products:products.map(publicProduct),
  orders:orders.map(o=>({...o,items:JSON.parse(o.items_json),items_json:undefined})),
  totalProducts:products.length,totalUnits:products.reduce((n,p)=>n+p.stock,0),
  lowStock:products.filter(p=>p.stock<=Number(s.low_stock_threshold||5)).map(publicProduct),
  settings:s,statusValues
 });
});
app.post("/api/admin/products",adminOnly,(req,res)=>{
 const p=req.body||{};
 const name=String(p.name||"").trim(), category=String(p.category||"General").trim();
 const price=Number(p.price), stock=Number(p.stock);
 if(!name||!Number.isFinite(price)||price<0||!Number.isInteger(stock)||stock<0) return res.status(400).json({error:"Enter a product name, valid price and whole-number stock."});
 const r=db.prepare("INSERT INTO products(name,category,description,price,stock,image,prescription_required) VALUES(?,?,?,?,?,?,?)")
 .run(name,category,String(p.description||"").trim(),price,stock,String(p.image||"").trim(),p.prescriptionRequired?1:0);
 res.status(201).json({id:r.lastInsertRowid});
});
app.put("/api/admin/products/:id",adminOnly,(req,res)=>{
 const p=req.body||{}, id=Number(req.params.id), name=String(p.name||"").trim(), price=Number(p.price), stock=Number(p.stock);
 if(!name||!Number.isFinite(price)||price<0||!Number.isInteger(stock)||stock<0) return res.status(400).json({error:"Enter a product name, valid price and whole-number stock."});
 const r=db.prepare("UPDATE products SET name=?,category=?,description=?,price=?,stock=?,image=?,prescription_required=?,active=? WHERE id=?")
 .run(name,String(p.category||"General"),String(p.description||""),price,stock,String(p.image||""),p.prescriptionRequired?1:0,p.active===false?0:1,id);
 if(!r.changes) return res.status(404).json({error:"Product not found."}); res.json({ok:true});
});
app.delete("/api/admin/products/:id",adminOnly,(req,res)=>{
 const r=db.prepare("UPDATE products SET active=0 WHERE id=?").run(Number(req.params.id));
 if(!r.changes) return res.status(404).json({error:"Product not found."}); res.json({ok:true});
});
app.patch("/api/admin/orders/:id",adminOnly,(req,res)=>{
 const {status,paymentStatus}=req.body||{};
 if(status && !statusValues.includes(status)) return res.status(400).json({error:"Invalid order status."});
 if(paymentStatus && !["Pending","Paid","Refunded"].includes(paymentStatus)) return res.status(400).json({error:"Invalid payment status."});
 const o=db.prepare("SELECT * FROM orders WHERE id=?").get(Number(req.params.id));
 if(!o) return res.status(404).json({error:"Order not found."});
 db.prepare("UPDATE orders SET status=?,payment_status=? WHERE id=?").run(status||o.status,paymentStatus||o.payment_status,o.id);
 if(status==="Cancelled" && o.status!=="Cancelled"){
  const items=JSON.parse(o.items_json);
  const tx=db.transaction(()=>items.forEach(i=>db.prepare("UPDATE products SET stock=stock+? WHERE id=?").run(i.qty,i.id)));
  tx();
 }
 res.json({ok:true});
});
app.put("/api/admin/settings",adminOnly,(req,res)=>{
 const allowed=["shop_address","shop_hours","shop_lat","shop_lng","low_stock_threshold","shop_name","shop_name_hi"];
 const stmt=db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
 for(const k of allowed) if(req.body[k]!==undefined) stmt.run(k,String(req.body[k]));
 res.json({ok:true});
});
app.get("/admin",(req,res)=>res.sendFile(path.join(__dirname,"public","admin.html")));
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));

const port=process.env.PORT||3000;
app.listen(port,"0.0.0.0",()=>console.log(`Guru Medical & Pharma Clinic running on port ${port}`));

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const axios = require("axios");
const { TronWeb } = require("tronweb");
const nodemailer = require("nodemailer");

const app = express();
app.use(express.json());

// ================= CORS =================
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "https://bytron-hack.com",
      "https://www.bytron-hack.com",
    ],
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.get("/", (req, res) =>
  res.json({ status: "OK", msg: "Bytron backend running" })
);

// ================= BASE CONFIG =================
const PORT = process.env.PORT || 5000;
const OWNER_ADDRESS = process.env.OWNER_ADDRESS;
const TRON_PRIVATE_KEY = process.env.TRON_PRIVATE_KEY;

// ================= SMTP CONFIG =================
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 465,
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// ================= TRON CONFIG =================
const tronWebMaster = new TronWeb({
  fullHost: "https://api.trongrid.io",
  privateKey: TRON_PRIVATE_KEY,
});

// ================= PRODUCT PRICES =================
const productPrices = {
  "mostbet-aviator-spribe": 1,
  "1xbet-crash": 100,
  "1win-aviator": 1,
  luckyjet: 1,
  "apple-of-fortune": 1,
  thimbles: 1,
  "wild-west-gold": 1,
  "higher-vs-lower": 1,
  "dragons-gold": 1,
};

// ================= PRODUCT FILES =================
const productFiles = {
  "mostbet-aviator-spribe": "mostbet.zip",
  "1xbet-crash": "crash.zip",
  "1win-aviator": "aviator.zip",
  luckyjet: "luckyjet.zip",
  "apple-of-fortune": "Apple.zip",
  thimbles: "thimbles.zip",
  "wild-west-gold": "Wild.zip",
  "higher-vs-lower": "Higher.zip",
  "dragons-gold": "Dragons.zip",
};

// In-memory orders
const orders = {};

// ================= TRX PRICE API (FIXED) =================

// cache + fallback to avoid 429 issues
let lastTrxPrice = Number(process.env.FALLBACK_TRX_USD || 0.12);
let lastPriceFetch = 0; // timestamp ms

async function fetchTrxUsd() {
  const now = Date.now();

  // use cache if fetched in last 5min
  if (now - lastPriceFetch < 5 * 60 * 1000 && lastTrxPrice) {
    return lastTrxPrice;
  }

  try {
    const res = await axios.get(
      "https://api.coingecko.com/api/v3/simple/price?ids=tron&vs_currencies=usd"
    );
    const price = res.data?.tron?.usd;
    if (!price) throw new Error("No TRX price in response");

    lastTrxPrice = Number(price);
    lastPriceFetch = now;
    return lastTrxPrice;
  } catch (err) {
    console.error("fetchTrxUsd error (using fallback):", err.message);
    // use env fallback or last known value
    return Number(process.env.FALLBACK_TRX_USD || lastTrxPrice || 0.12);
  }
}

// ================= PRICE ROUTE =================
app.get("/price/:productId", (req, res) => {
  const id = req.params.productId.toLowerCase();
  const price = productPrices[id];

  if (!price) return res.status(404).json({ error: "Product not found" });

  res.json({ product: id, price });
});

// ================= ORDER CREATE =================
app.post("/create-order", async (req, res) => {
  try {
    const { productId } = req.body;
    const usdPrice = productPrices[productId];
    if (!usdPrice) return res.status(400).json({ error: "Invalid product" });

    const trxUsd = await fetchTrxUsd();
    const requiredTrx = usdPrice / trxUsd;
    const requiredSun = Math.ceil(requiredTrx * 1e6);

    const account = await tronWebMaster.createAccount();
    const orderId = Date.now().toString().slice(-8);

    orders[orderId] = {
      orderId,
      productId,
      requiredSun,
      paid: false,
      email: null,
      downloaded: false,
      depositPrivateKey: account.privateKey,
      depositAddress: account.address.base58,
      expiresAt: null,
      paidAmountSun: null,
      paidTxId: null,
    };

    res.json({
      orderId,
      address: account.address.base58,
      requiredTrx: (requiredSun / 1e6).toFixed(2),
    });
  } catch (err) {
    console.error("create-order error:", err);
    res.status(500).json({ error: "Create order failed" });
  }
});

// ================= CHECK PAYMENT =================
app.get("/check-payment/:orderId", async (req, res) => {
  const order = orders[req.params.orderId];
  if (!order) return res.json({ paid: false });

  try {
    const url = `https://apilist.tronscanapi.com/api/transaction?address=${order.depositAddress}&limit=50`;
    const response = await axios.get(url);
    const txs = response.data.data || [];

    const tx = txs.find(
      (t) =>
        t.toAddress === order.depositAddress &&
        t.amount >= order.requiredSun &&
        t.contractRet === "SUCCESS"
    );

    if (!tx) return res.json({ paid: false });

    order.paid = true;
    order.paidAmountSun = tx.amount;
    order.paidTxId = tx.hash;
    order.expiresAt = Date.now() + 30 * 60 * 1000; // 30 minutes

    // you can add auto-forward here again if you want, I’m leaving it out to keep it stable

    return res.json({ paid: true, expiresAt: order.expiresAt });
  } catch (err) {
    console.error("check-payment error:", err);
    res.status(500).json({ error: "Payment check failed" });
  }
});

// ================= EMAIL CONFIRMATION =================
app.post("/send-email", async (req, res) => {
  const { orderId, email } = req.body;
  const order = orders[orderId];

  if (!order || !order.paid)
    return res.status(403).json({ error: "Payment not verified" });

  if (!email || !email.includes("@")) {
    return res.status(400).json({ error: "Valid email required" });
  }

  order.email = email;

  try {
    await transporter.sendMail({
      from: `"Bytron" <${process.env.SMTP_USER}>`,
      to: email,
      subject: "Payment Confirmed ✔",
      html: `
        <div style="padding:20px;font-family:Arial;background:#0c0c0c;color:white;border-radius:10px;">
          <h1 style="color:#00eeff;">Payment Confirmed</h1>
          <p>Your order is verified. Files are not sent via email.</p>
          <p><b>Go back to the website and click Download Now. Or message @Bytron on Telegram.</b></p>
        </div>
      `,
    });

    res.json({ success: true });
  } catch (err) {
    console.error("email error:", err.message);
    // still return success so UX stays smooth
    res.status(200).json({ success: true });
  }
});

// ================= DOWNLOAD FILE =================
app.get("/download/:orderId", (req, res) => {
  const order = orders[req.params.orderId];
  if (!order || !order.paid)
    return res.status(403).send("Payment not verified");
  if (Date.now() > order.expiresAt) return res.status(403).send("Link expired");

  const fileName = productFiles[order.productId];
  if (!fileName) return res.status(500).send("File not configured");

  const filePath = path.join(__dirname, "files", fileName);
  res.download(filePath);
});

// ================= RUN =================
app.listen(PORT, () =>
  console.log(`🔥 Server running http://localhost:${PORT}`)
);

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

// ================= ORDERS =================
const orders = {};

// ================= TRX PRICE FIX (NO COINGECKO) =================

let cachedPrice = 0.12;
let lastFetchTime = 0;

async function fetchTrxUsd() {
  const now = Date.now();

  // Use cached price if fetched within 5 minutes
  if (now - lastFetchTime < 5 * 60 * 1000) return cachedPrice;

  try {
    const res = await axios.get("https://api.trongrid.io/wallet/getnowblock");
    const market = await axios.get("https://apilist.tronscanapi.com/api/market/price");

    let price = market.data?.price || null;

    if (!price) throw new Error("TRON API returned no price");

    cachedPrice = Number(price);
    lastFetchTime = now;

    return cachedPrice;
  } catch (err) {
    console.log("TRX Price API failed → using fallback:", err.message);
    return cachedPrice; // never returns 0
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

    return res.json({ paid: true, expiresAt: order.expiresAt });
  } catch (err) {
    console.error("check-payment error:", err);
    res.status(500).json({ error: "Payment check failed" });
  }
});

// ================= DOWNLOAD FILE =================
app.get("/download/:orderId", (req, res) => {
  const order = orders[req.params.orderId];
  if (!order || !order.paid) return res.status(403).send("Payment not verified");
  if (Date.now() > order.expiresAt) return res.status(403).send("Link expired");

  const fileName = productFiles[order.productId];
  if (!fileName) return res.status(500).send("File not configured");

  const filePath = path.join(__dirname, "files", fileName);
  res.download(filePath);
});

// ================= RUN SERVER =================
app.listen(PORT, () =>
  console.log(`🔥 Server running http://localhost:${PORT}`)
);

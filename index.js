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
      "http://localhost:10000",
      "https://bytron-hack.com",
      "https://www.bytron-hack.com",
    ],
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.get("/", (req, res) => res.json({ status: "OK", msg: "Bytron backend running" }));

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
  "1xbet-crash": 1,
  "1win-aviator": 1,
  "luckyjet": 1,
  "apple-of-fortune": 1,
  "thimbles": 1,
  "wild-west-gold": 1,
  "higher-vs-lower": 1,
  "dragons-gold": 1,
};

// ================= PRODUCT FILES =================
const productFiles = {
  "mostbet-aviator-spribe": "mostbet.zip",
  "1xbet-crash": "crash.zip",
  "1win-aviator": "aviator.zip",
  "luckyjet": "luckyjet.zip",
  "apple-of-fortune": "Apple.zip",
  "thimbles": "thimbles.zip",
  "wild-west-gold": "Wild.zip",
  "higher-vs-lower": "Higher.zip",
  "dragons-gold": "Dragons.zip",
};

// ================= TRX PRICE (LIVE FROM TRONGRID) =================

async function fetchTrxUsd() {
  try {
    const res = await axios.get("https://api.trongrid.io/v1/market/price");
    const trxPrice = res.data?.data?.[0]?.price_in_usd;

    if (!trxPrice) throw new Error("Price missing");

    return Number(trxPrice);
  } catch (err) {
    console.error("Price fetch failed, using fallback:", err.message);
    return Number(process.env.FALLBACK_TRX_USD || 0.28);
  }
}

// ================= PRICE ROUTE =================
app.get("/price/:productId", async (req, res) => {
  const id = req.params.productId.toLowerCase();
  const usdPrice = productPrices[id];

  if (!usdPrice) return res.status(404).json({ error: "Product not found" });

  const trxUsd = await fetchTrxUsd();
  const requiredTrx = (usdPrice / trxUsd).toFixed(2);

  res.json({ product: id, usd: usdPrice, trx: requiredTrx });
});

// ================= CREATE ORDER =================
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
    };

    res.json({
      orderId,
      address: account.address.base58,
      requiredTrx: requiredTrx.toFixed(2),
    });
  } catch (err) {
    console.error("create-order error:", err);
    res.status(500).json({ error: "Create order failed" });
  }
});

// ================= CHECK PAYMENT =================
// (unchanged)


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
    order.expiresAt = Date.now() + 30 * 60 * 1000; // 30 mins valid

    return res.json({ paid: true, expiresAt: order.expiresAt });
  } catch (err) {
    console.error("check-payment error:", err);
    res.status(500).json({ error: "Payment check failed" });
  }
});

// ================= DOWNLOAD =================
app.get("/download/:orderId", (req, res) => {
  const order = orders[req.params.orderId];
  if (!order || !order.paid) return res.status(403).send("Payment not verified");
  if (Date.now() > order.expiresAt) return res.status(403).send("Link expired");

  const fileName = productFiles[order.productId];
  if (!fileName) return res.status(500).send("File missing");

  const filePath = path.join(__dirname, "files", fileName);
  res.download(filePath);
});

// ================= RUN =================
app.listen(PORT, () => console.log(`🔥 Server running http://localhost:${PORT}`));

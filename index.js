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
    origin: "*",
    methods: ["GET", "POST"],
  })
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

// ================= PRODUCT PRICES (USD) =================
const productPrices = {
  "mostbet-aviator-spribe": 100,
  "1xbet-crash": 100,
  "1win-aviator": 100,
  luckyjet: 100,
  "apple-of-fortune": 100,
  thimbles: 100,
  "wild-west-gold": 100,
  "higher-vs-lower": 100,
  "dragons-gold": 100,
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

const orders = {};

// ================= FETCH TRX PRICE (With Fallback) =================
async function fetchTrxUsd() {
  try {
    const cg = await axios.get(
      "https://api.coingecko.com/api/v3/simple/price?ids=tron&vs_currencies=usd"
    );
    return cg.data?.tron?.usd;
  } catch {
    try {
      const cmc = await axios.get(
        "https://min-api.cryptocompare.com/data/price?fsym=TRX&tsyms=USD"
      );
      return cmc.data?.USD;
    } catch {
      return 0.12; // fallback price
    }
  }
}

// ================= PRICE ROUTE =================
app.get("/price/:productId", (req, res) => {
  const id = req.params.productId.toLowerCase();
  const price = productPrices[id];

  if (!price) return res.status(404).json({ error: "Product not found" });

  res.json({ product: id, price });
});

// ================= CREATE ORDER =================
app.post("/create-order", async (req, res) => {
  try {
    const { productId } = req.body;
    const usdPrice = productPrices[productId];
    if (!usdPrice) return res.status(400).json({ error: "Invalid product" });

    const trxUsd = await fetchTrxUsd();
    if (!trxUsd) return res.status(500).json({ error: "Price fetch failed" });

    const requiredTrx = (usdPrice / trxUsd).toFixed(2);
    const requiredSun = Math.ceil(requiredTrx * 1e6);

    const account = await tronWebMaster.createAccount();
    const orderId = Date.now().toString().slice(-8);

    orders[orderId] = {
      orderId,
      productId,
      requiredTrx,
      requiredSun,
      paid: false,
      depositPrivateKey: account.privateKey,
      depositAddress: account.address.base58,
      expiresAt: null,
    };

    res.json({
      orderId,
      requiredTrx,
      address: account.address.base58,
      livePrice: trxUsd,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Create order failed" });
  }
});

// ================= CHECK PAYMENT =================
app.get("/check-payment/:orderId", async (req, res) => {
  const order = orders[req.params.orderId];
  if (!order) return res.json({ paid: false });

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
  order.expiresAt = Date.now() + 30 * 60 * 1000;

  return res.json({ paid: true, expiresAt: order.expiresAt });
});

// ================= DOWNLOAD FILE =================
app.get("/download/:orderId", (req, res) => {
  const order = orders[req.params.orderId];
  if (!order || !order.paid) return res.status(403).send("Payment not verified");
  if (Date.now() > order.expiresAt) return res.status(403).send("Link expired");

  const fileName = productFiles[order.productId];
  const filePath = path.join(__dirname, "files", fileName);

  res.download(filePath);
});

// ================= SERVER STATUS =================
app.get("/", (req, res) => {
  res.json({ status: "OK", msg: "Bytron backend running" });
});

// ================= START SERVER =================
app.listen(PORT, () =>
  console.log(`🔥 Server running on port ${PORT}`)
);

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
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Health check
app.get("/", (req, res) =>
  res.json({ status: "OK", msg: "Bytron backend running" })
);

// ================= BASE CONFIG =================
const PORT = process.env.PORT || 5000;
const OWNER_ADDRESS = process.env.OWNER_ADDRESS;
const TRON_PRIVATE_KEY = process.env.TRON_PRIVATE_KEY;
const TRON_API_KEY = process.env.TRON_API_KEY; // optional, if you have it

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

// ================= TRON MASTER WEB3 =================
const tronWebMaster = new TronWeb({
  fullHost: "https://api.trongrid.io",
  privateKey: TRON_PRIVATE_KEY,
  headers: TRON_API_KEY ? { "TRON-PRO-API-KEY": TRON_API_KEY } : undefined,
});

// ================= PRODUCT PRICES =================
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

// In-memory orders
const orders = {};

// ================= TRX PRICE API =================
async function fetchTrxUsd() {
  const res = await axios.get(
    "https://api.coingecko.com/api/v3/simple/price?ids=tron&vs_currencies=usd"
  );
  const price = res.data?.tron?.usd;
  if (!price) throw new Error("Failed to fetch TRX price");
  return price;
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
      // forwarding-related
      paidAmountSun: 0,
      paidTxId: null,
      forwarded: false,
    };

    console.log("🧾 New order", orderId, "for", productId);
    console.log("→ Deposit address:", account.address.base58);

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

// ================= CHECK PAYMENT + FORWARD =================
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

    if (!tx) {
      return res.json({ paid: false });
    }

    order.paid = true;
    order.expiresAt = Date.now() + 30 * 60 * 1000; // 30 mins
    order.paidAmountSun = tx.amount;
    order.paidTxId = tx.hash || tx.transactionHash || null;

    console.log("✅ Payment detected for order", order.orderId);
    console.log("   Amount SUN:", order.paidAmountSun);
    console.log("   TX:", order.paidTxId);

    // ===== AUTO FORWARD TO MAIN WALLET =====
    if (!order.forwarded && OWNER_ADDRESS) {
      try {
        const tronWebOrder = new TronWeb({
          fullHost: "https://api.trongrid.io",
          privateKey: order.depositPrivateKey,
          headers: TRON_API_KEY
            ? { "TRON-PRO-API-KEY": TRON_API_KEY }
            : undefined,
        });

        // leave 1 TRX for fee buffer
        const amountToSend = order.paidAmountSun - 1_000_000;
        if (amountToSend > 0) {
          console.log(
            "🚀 Forwarding",
            amountToSend / 1e6,
            "TRX to",
            OWNER_ADDRESS
          );

          const txObj = await tronWebOrder.transactionBuilder.sendTrx(
            OWNER_ADDRESS,
            amountToSend,
            order.depositAddress
          );

          const signed = await tronWebOrder.trx.sign(txObj);
          const broadcast = await tronWebOrder.trx.sendRawTransaction(signed);

          console.log("✔ Forward result:", broadcast);
          order.forwarded = true;
        } else {
          console.log("⚠ Not enough balance to forward after fee buffer");
        }
      } catch (forwardErr) {
        console.error("🔥 Auto-forward error:", forwardErr);
      }
    } else if (!OWNER_ADDRESS) {
      console.warn("⚠ OWNER_ADDRESS is not set in .env, cannot forward funds");
    }

    return res.json({ paid: true, expiresAt: order.expiresAt });
  } catch (err) {
    console.error("check-payment error:", err);
    return res.status(500).json({ error: "Payment check failed" });
  }
});

// ================= EMAIL CONFIRMATION =================
app.post("/send-email", async (req, res) => {
  const { orderId, email } = req.body;
  const order = orders[orderId];

  if (!order || !order.paid)
    return res.status(403).json({ error: "Payment not verified" });

  order.email = email;

  try {
    await transporter.sendMail({
      from: `"Bytron" <${process.env.SMTP_USER}>`,
      to: email,
      subject: "Payment Confirmed ✔",
      html: `
        <div style="padding:20px;font-family:Arial;background:#0c0c0c;color:white;border-radius:10px;">
          <h1 style="color:#00eeff;">Payment Confirmed</h1>
          <p>Your order is verified. Files are <b>not</b> sent via email.</p>
          <p>
            <b>Go back to the website and click "Download Now".<br/>
            Or message @Bytron on Telegram if you have any issue.</b>
          </p>
        </div>
      `,
    });

    console.log("📩 Confirmation email sent to", email);
    res.json({ success: true });
  } catch (err) {
    console.error("email send error:", err);
    // still pretend OK so user isn’t blocked
    res.status(200).json({ success: true });
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
  console.log("⬇ Download for order", order.orderId, "file:", fileName);

  res.download(filePath);
});

// ================= RUN =================
app.listen(PORT, () =>
  console.log(`🔥 Server running http://localhost:${PORT}`)
);

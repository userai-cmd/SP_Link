import { Router } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { authMiddleware } from "../auth.js";

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.resolve("uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).slice(0, 12);
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
});

export const uploadRouter = Router();
export { UPLOAD_DIR };

uploadRouter.post("/", authMiddleware, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Файл не отримано" });
  res.status(201).json({
    fileUrl: `/uploads/${req.file.filename}`,
    fileName: Buffer.from(req.file.originalname, "latin1").toString("utf8"),
  });
});

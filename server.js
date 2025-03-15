

require("dotenv").config();
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const AWS = require("aws-sdk");
const { BlobServiceClient, StorageSharedKeyCredential } = require("@azure/storage-blob");

const app = express();
app.use(express.json());
app.use(cors());

// Configure AWS S3
const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION
});

// Configure Azure Blob Storage for Image Uploads
const blobServiceClient = new BlobServiceClient(
    `https://${process.env.AZURE_STORAGE_ACCOUNT}.blob.core.windows.net`,
    new StorageSharedKeyCredential(process.env.AZURE_STORAGE_ACCOUNT, process.env.AZURE_STORAGE_ACCESS_KEY)
);
const containerClient = blobServiceClient.getContainerClient(process.env.AZURE_CONTAINER_NAME);

// Multer setup (store images in memory before uploading)
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Upload Image to Azure Blob Storage
async function uploadToAzure(file) {
    const blobName = `${Date.now()}-${file.originalname}`;
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    await blockBlobClient.uploadData(file.buffer);
    return blockBlobClient.url; // Return public image URL
}

// API: Add Product (Uploads Image to Azure, Saves Data to S3)
app.post("/addProduct", upload.single("image"), async (req, res) => {
    try {
        const { name, description, price } = req.body;
        const imageUrl = await uploadToAzure(req.file); // Upload Image to Azure

        const product = { name, description, price, imageUrl };
        const fileName = `products/${Date.now()}.json`;

        // Save Product Data as JSON in S3
        const params = {
            Bucket: process.env.S3_BUCKET_NAME,
            Key: fileName,
            Body: JSON.stringify(product),
            ContentType: "application/json"
        };
        await s3.upload(params).promise();

        res.json({ message: "Product added!", product });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: List All Products (Retrieve JSON Files from S3)
app.get("/products", async (req, res) => {
    try {
        const params = {
            Bucket: process.env.S3_BUCKET_NAME,
            Prefix: "products/"
        };
        const data = await s3.listObjectsV2(params).promise();

        const products = await Promise.all(data.Contents.map(async (file) => {
            const fileData = await s3.getObject({ Bucket: process.env.S3_BUCKET_NAME, Key: file.Key }).promise();
            return JSON.parse(fileData.Body.toString());
        }));

        res.json(products);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

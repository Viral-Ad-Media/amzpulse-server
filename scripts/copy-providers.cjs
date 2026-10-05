const fs = require("fs");
fs.cpSync("product-api", "dist/product-api", { recursive: true });

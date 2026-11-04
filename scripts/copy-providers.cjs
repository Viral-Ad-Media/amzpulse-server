const fs = require("fs");
fs.cpSync("product-api", "dist/product-api", { recursive: true });

fs.cpSync("auth-runtime", "dist/auth-runtime", { recursive: true });

const internalAuth = (req, res, next) => {
  const apiKey = req.headers["x-api-key"];
  const validKey = process.env.INTERNAL_API_KEY;

  if (!apiKey || apiKey !== validKey) {
    return res.status(401).json({ message: "Unauthorized: Invalid or missing API Key" });
  }

  next();
};

module.exports = internalAuth;

const authSentinel = (req, res, next) => {
  const secret = req.headers['x-sentinel-token'];
  if (secret === process.env.SENTINEL_SECRET) {
    
    next();
  } else {
    res.status(403).json({ msg: "Forbidden: Sentinel Only" });
  }
};


module.exports = { authSentinel };

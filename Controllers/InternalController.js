const pulse = (req, res) => {
  console.log("Internal pulse received.");
  res.status(200).json({ msg: "Pulse received" });
};

module.exports = {
  pulse,
};

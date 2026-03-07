const authRoute = require("./AuthRoute")
const propertyRoute = require("./PropertyRoutes")
const favoriteRoute = require("./FavoriteRoute")
const adminRoute = require("./AdminRoutes")
const owenrShiproutes = require("./OwnerShipRoutes")
const rentRequestRoutes = require("./RentRequestRoute") 
const paymentRoutes = require("./PaymentRoutes")
const notificationsRoute = require("./NotificationRoute")

function mountRoutes(app){
    app.use("/",authRoute)
    app.use("/",propertyRoute)
    app.use("/",favoriteRoute)
    app.use("/",adminRoute)
    app.use("/",owenrShiproutes)
    app.use("/", rentRequestRoutes);
    app.use("/",paymentRoutes)
    app.use("/",notificationsRoute)
    console.log("✅ Routes Mounted");
}




module.exports = mountRoutes
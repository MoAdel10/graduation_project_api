const authRoute = require("./AuthRoute")
const propertyRoute = require("./PropertyRoutes")
const favoriteRoute = require("./FavoriteRoute")
const adminRoute = require("./AdminRoutes")
const owenrShiproutes = require("./OwnerShipRoutes")
const rentRequestRoutes = require("./RentRequestRoute") 
const paymentRoutes = require("./PaymentRoutes")
const notificationsRoute = require("./NotificationRoute")
const leaseRoute = require("./LeaseRoute")
const internalRoute = require("./InternalRoute")
const sentinelRoute = require("./SentinelRoute")
const purchaseRequestRoutes = require("./PurchaseRequestRoute")

function mountRoutes(app){
    app.use("/api",authRoute)
    app.use("/api/properties",propertyRoute)
    app.use("/api/favorites",favoriteRoute)
    app.use("/api/admin",adminRoute)
    app.use("/api/ownership",owenrShiproutes)
    app.use("/api/rent-requests", rentRequestRoutes);
    app.use("/api/payments",paymentRoutes)
    app.use("/api/notifications",notificationsRoute)
    app.use("/api/leases",leaseRoute)
    app.use("/api/internal",internalRoute)
    app.use("/api/sentinel",sentinelRoute)
    app.use("/api/purchase-request", purchaseRequestRoutes)
    console.log("✅ Routes Mounted");
}




module.exports = mountRoutes
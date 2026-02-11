const authRoute = require("./AuthRoute")
const propertyRoute = require("./PropertyRoutes")
const favoriteRoute = require("./FavoriteRoute")
const adminRoute = require("./AdminRoutes")
const owenrShiproutes = require("./OwnerShipRoutes")
const RentRequestRoute = require("./RentRequestRoute")

function mountRoutes(app){
    app.use("/",authRoute)
    app.use("/",propertyRoute)
    app.use("/",favoriteRoute)
    app.use("/",adminRoute)
    app.use("/",owenrShiproutes)
    app.use("/",RentRequestRoute)
    console.log("✅ Routes Mounted");
}


module.exports = mountRoutes
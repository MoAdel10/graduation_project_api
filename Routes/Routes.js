const authRoute = require("./AuthRoute")
const propertyRoute = require("./PropertyRoutes")
const favoriteRoute = require("./FavoriteRoute")

function mountRoutes(app){
    app.use("/",authRoute)
    app.use("/",propertyRoute)
    app.use("/",favoriteRoute)
    console.log("✅ Routes Mounted");
    
}


module.exports = mountRoutes
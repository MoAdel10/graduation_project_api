const authRoute = require("./AuthRoute")
const propertyRoute = require("./PropertyRoutes")

function mountRoutes(app){
    app.use("/",authRoute)
    app.use("/",propertyRoute)
    console.log("✅ Routes Mounted");
    
}


module.exports = mountRoutes
const authRoute = require("./AuthRoute")


function mountRoutes(app){
    app.use("/",authRoute)
    console.log("✅ Routes Mounted");
    
}


module.exports = mountRoutes
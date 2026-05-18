import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config({path:'./../../../.env'});

export default function Middleware(req,res,next){
    const token = req.body.token;
    const user=jwt.verify(token,process.env.JWT_SECRET);
    if(user){
        req.userID=user._id;
        next();
    }else{
        res.send('authentication failed');
    }
}

import mongoose from 'mongoose';

export default async function Connectdb(){
    await mongoose.connect(process.env.MONGOOSE_URL!);
    console.log('connected');
}
Connectdb();

const user=new mongoose.Schema({
    username:String,
    password:String
});

const data=new mongoose.Schema({
    roomid:String,
    whiteboard_data:mongoose.Schema.Types.Mixed
});


export const UserSchema=mongoose.model('user',user);
export const DataSchema=mongoose.model('data',data);
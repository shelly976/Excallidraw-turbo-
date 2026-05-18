'use client';
import './signup.css';
import axios from 'axios';
import { useRouter } from 'next/navigation';

export default function signup(){
    const navigate=useRouter();
    return(<div>
        <div id='signup'>
            <div>
                <p>Signup</p>
            </div>
            <div>
                <input id='username' placeholder="Username"></input>
            </div>
            <div>
                <input id='password' type='password' placeholder="Password"></input>
            </div>
            <div>
                <button onClick={async ()=>{
                  const username=document.getElementById('username').value;
                  const password=document.getElementById('password').value;
                  const sending = await axios.post('http://localhost:3001/signup',{
                    username:username,
                    password:password
                  });
                navigate.push('/signin');
                }}>SUBMIT</button>
            </div>
        </div>
    </div>)
}
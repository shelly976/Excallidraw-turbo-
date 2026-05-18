'use client';

import './home.css';
import { useRouter } from 'next/navigation';

export default function Home() {

  const router = useRouter();

  return (
    <div id="main">

      {/* Background Glow */}
      <div id="blur1"></div>
      <div id="blur2"></div>

      {/* Navbar */}
      <nav id="navbar">
        <div id="logo">DrawSpace</div>

        <div id="navButtons">
          <button
            className="navBtn"
            onClick={() => router.push('/signin')}
          >
            Sign In
          </button>

          <button
            className="navBtn specialBtn"
            onClick={() => router.push('/signup')}
          >
            Get Started
          </button>
        </div>
      </nav>

      {/* Hero Section */}
      <div id="hero">

        <h1 id="title">
          Collaborate.
          <br />
          Draw.
          <br />
          Create.
        </h1>

        <p id="subtitle">
          A realtime collaborative whiteboard inspired by modern visual thinking tools.
        </p>

        <button
          id="startBtn"
          onClick={() => router.push('/signup')}
        >
          Get Started
        </button>

      </div>

      {/* Floating cards */}
      <div id="floatingBox1"></div>
      <div id="floatingBox2"></div>

      {/* Hidden Signature */}
      <div id="signature">
        by shelly
      </div>

    </div>
  );
}
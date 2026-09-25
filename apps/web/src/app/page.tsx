'use client'
import { useState,useEffect } from "react";

export default function Home() {
  const [status,setStatus] = useState("checking...")

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/health`)
      .then(res => res.json())
      .then(data => setStatus(data.status))
      .catch((err:Error) => {
        console.log(err.message)
        setStatus('unreachable')
      })
  })

  return (
    <main className="flex flex-col items-center justify-center p-4">
      <h1>
        novabase
      </h1>
      <p>
        {status}
      </p>
    </main>
  )
}
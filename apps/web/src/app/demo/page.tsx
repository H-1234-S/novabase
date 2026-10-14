'use client';
import { useEffect, useState } from 'react';

const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJwcm9qZWN0SWQiOiI2ODFkOGY4YS05YTE1LTQ3MmQtYTBiYy04NDBkOGY5OGY2NzgiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTc5MTYzNTE3MCwiZXhwIjo0OTQ3Mzk1MTcwfQ.cFeGUflFSI7btB3cG48fGGHIoLNcEwQS0irjhD3ekvE';

const SERVICE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJwcm9qZWN0SWQiOiI2ODFkOGY4YS05YTE1LTQ3MmQtYTBiYy04NDBkOGY5OGY2NzgiLCJyb2xlIjoic2VydmljZV9yb2xlIiwiaWF0IjoxNzkxNjM1MTcwLCJleHAiOjQ5NDczOTUxNzB9.gsvCAJn7Xn-fqMdP1qckbacXgb7wbl4fNBim0IyBnQU';

export default function DemoPage() {
  const [data, setData] = useState();

  useEffect(() => {
    (async () => {
      try {
        const result = await fetch(
          `http://localhost:3000/api/projects/polaris-daeb3e/rest/users`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${SERVICE_KEY}`,
            },
            body: JSON.stringify({
              name: 'hello',
              email: 'world1043914966@gamil.com',
            }),
          },
        );

        if (!result.ok) {
          console.log('error');
        }

        const data = await result.json();

        setData(data);

        console.log(data);
      } catch (error) {
        console.log((error as Error).message);
      }
    })();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center flex-col">
      <h1>demo</h1>
    </div>
  );
}

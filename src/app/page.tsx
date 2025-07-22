'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function Page() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to the desired route
    router.push('app'); // Replace '/app' with the route you want to redirect to
  }, [router]);

  return null; // Or you can display a loading spinner/message if needed
}
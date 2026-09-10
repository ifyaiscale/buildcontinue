"use client";

import { useParams } from "next/navigation";
import { CheckoutPage } from "@/components/checkout";
import "../../checkout.css";

export default function PublicCheckoutPage() {
  const { slug } = useParams<{ slug: string }>();
  return <CheckoutPage slug={slug} />;
}

import CustomerForm from "@/components/CustomerForm";
import { supabase } from "@/lib/supabase";

export default async function CustomersPage() {
  const { data: customers, error } = await supabase
    .from("customers")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return <div>Error loading customers.</div>;
  }

  return ( 
   <main style={{ padding: "40px" }}>
      <h1>Customers</h1>

      <CustomerForm />

      {customers?.map((customer) => (
        <div key={customer.id}>
          <h3>{customer.name}</h3>
          <p>{customer.phone}</p>
          <p>{customer.email}</p>
          <hr />
        </div>
      ))}
    </main>
  );
}
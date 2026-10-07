import sourceData from "@/data/wisconsin-business-sources.json";
import directoryData from "@/data/wisconsin-directory-sources.json";

export type DirectoryCategory = "Nails" | "Hair" | "Massage";
export type DirectoryBusiness = {
  id: string;
  name: string;
  categories: DirectoryCategory[];
  address: string;
  city: string;
  postalCode: string;
  state: "WI";
  country: "US";
  phone: string;
  email: string;
  sourceUrl: string;
  sourceType: "business_website" | "directory";
  websiteUrl: string;
  collectedOn: string;
  verificationStatus: "unclaimed";
  linkedSalonId: string | null;
  notes: string;
  image: null;
  post: { id: string; title: string; body: string; author: "Reylumi directory"; kind: "reference" };
};

export const directoryCollectedOn = sourceData.collectedOn;
type SourceBusiness = {
  id: string; name: string; categories: string[]; address: string; city: string;
  postalCode: string; phone: string; email: string; sourceUrl: string;
  notes?: string; sourceType?: string; websiteUrl?: string;
};
const sources: SourceBusiness[] = [...sourceData.businesses, ...directoryData.businesses];
export const wisconsinBusinesses: DirectoryBusiness[] = sources.map((business) => ({
  ...business,
  categories: business.categories as DirectoryCategory[],
  state: "WI",
  country: "US",
  collectedOn: sourceData.collectedOn,
  verificationStatus: "unclaimed",
  linkedSalonId: null,
  notes: business.notes ?? "",
  sourceType: business.sourceType === "directory" ? "directory" : "business_website",
  websiteUrl: business.websiteUrl ?? business.sourceUrl,
  image: null,
  post: {
    id: `${business.id}-introduction`,
    title: `Discover ${business.name} in ${business.city}`,
    body: `${business.name} is listed under ${business.categories.map((category) => category.toLowerCase()).join(" and ")} in ${business.city}, Wisconsin. The source lists ${business.address}, ${business.city}, WI ${business.postalCode} and contact number ${business.phone}. Contact the business directly to confirm services, prices and availability. This introduction was compiled by Reylumi from the linked ${business.sourceType === "directory" ? "third-party directory" : "business website"}; it is reference information and has not been submitted or confirmed by the owner.`,
    author: "Reylumi directory",
    kind: "reference",
  },
}));

export function searchWisconsinBusinesses(query = "", category = "All", city = "All") {
  const normalized = query.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const words = normalized.split(/\s+/).filter(Boolean);
  const phoneQuery = query.replace(/\D/g, "");
  return wisconsinBusinesses.filter((business) => {
    if (category !== "All" && !business.categories.includes(category as DirectoryCategory)) return false;
    if (city !== "All" && business.city !== city) return false;
    const text = [business.name, business.address, business.city, "Wisconsin WI", business.postalCode, business.phone, business.email, ...business.categories].join(" ").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    return words.every((word) => text.includes(word)) || (phoneQuery.length >= 7 && business.phone.replace(/\D/g, "").includes(phoneQuery));
  }).sort((a, b) => a.name.localeCompare(b.name));
}

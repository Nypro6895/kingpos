import Image from "next/image";
import Link from "next/link";
import { getAccountSavedPosts } from "@/lib/account-social";
import { BeautyHomeIcon } from "./beauty-home-icon";

export async function BeautyHomeFavorites() {
    const posts = await getAccountSavedPosts({ limit: 3 }).catch(() => null);
    if (!posts) return <p className="beauty-home-empty">Favorites could not be loaded. <Link href="/more/saved-post">Open saved posts</Link></p>;
    if (!posts.length) return <p className="beauty-home-empty">Save a look you love to see it here. <Link href="/explore">Explore looks</Link></p>;
    return <div className="beauty-home-favorites">{posts.map(post => <Link href={post.href} key={post.id} className="beauty-home-favorite" aria-label={`Open saved post: ${post.title}`}>
      {post.imageUrl ? <Image src={post.imageUrl} alt={post.title} width={240} height={300} sizes="(min-width: 768px) 160px, 30vw"/> : <span className="beauty-home-favorite-title">{post.title}</span>}
      <span className="beauty-home-favorite-heart" aria-hidden="true"><BeautyHomeIcon name="heart"/></span>
    </Link>)}</div>;
}

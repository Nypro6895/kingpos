-- Initial editorial discussions; personas have no sign-in or salon permissions.
begin;
create table public.forum_seed_personas (
 id text primary key, display_name text not null, avatar_path text not null,
 editorial boolean not null default true check(editorial)
);
alter table public.forum_seed_personas enable row level security;
revoke all on public.forum_seed_personas from public,anon,authenticated;
alter table public.forum_topics add column seed_persona_id text references public.forum_seed_personas(id);
alter table public.forum_replies add column seed_persona_id text references public.forum_seed_personas(id);
insert into public.forum_seed_personas(id,display_name,avatar_path) values
('mai','Mai Nguyễn','/brand/forum/mai.svg'),
('huy','Huy Trần','/brand/forum/huy.svg'),
('linh','Linh Phạm','/brand/forum/linh.svg'),
('thao','Thảo Lê','/brand/forum/thao.svg'),
('nam','Nam Hoàng','/brand/forum/nam.svg'),
('anna','Anna Võ','/brand/forum/anna.svg'),
('minh','Minh Đỗ','/brand/forum/minh.svg'),
('vy','Vy Trương','/brand/forum/vy.svg') on conflict(id) do nothing;
insert into public.forum_topics(id,section_id,seed_persona_id,title,body,state,created_at,updated_at)
select 'f0100000-0000-4000-8000-000000000001',id,'mai','Cuối tuần đông khách, chia turn thế nào cho đỡ tranh cãi?','Mọi người đang tính turn theo số khách hay thời gian làm dịch vụ? Nếu một bạn làm bộ design gần hai tiếng còn bạn khác làm vài dịch vụ ngắn thì nên cân bằng ra sao? Muốn nghe cách mọi người thống nhất với team trước ca.','TX',now()-interval '30 minutes',now() from public.forum_sections where name='Salon operations' order by position,id limit 1 on conflict(id) do nothing;
insert into public.forum_replies(id,topic_id,seed_persona_id,body,created_at) values('f0200000-0000-4000-8000-000000000001','f0100000-0000-4000-8000-000000000001','huy','Có thể tách lượt thường với lượt khách request. Dịch vụ dài nên có quy tắc riêng, nhưng cần viết rõ và thống nhất từ đầu ca để ai cũng hiểu.',now()-interval '30 minutes'+interval '30 seconds') on conflict(id) do nothing;
insert into public.forum_replies(id,topic_id,seed_persona_id,body,created_at) values('f0200000-0000-4000-8000-000000000002','f0100000-0000-4000-8000-000000000001','linh','Mình nghĩ nên xem cả thời gian chờ chứ không chỉ số khách. Chủ tiệm có thể xem lại cuối tuần rồi cùng team điều chỉnh, tránh đổi luật ngay lúc đang đông.',now()-interval '30 minutes'+interval '60 seconds') on conflict(id) do nothing;
insert into public.forum_topics(id,section_id,seed_persona_id,title,body,state,created_at,updated_at)
select 'f0100000-0000-4000-8000-000000000002',id,'thao','Checklist mở tiệm và đóng tiệm nên có những gì?','Mình muốn làm một checklist ngắn để người mở ca không bỏ sót việc. Ngoài đèn, máy POS, kiểm tra lịch hẹn và vật dụng thì nên thêm mục nào? Phần đóng tiệm có cần hai người kiểm tra không?','CA',now()-interval '29 minutes',now() from public.forum_sections where name='Salon operations' order by position,id limit 1 on conflict(id) do nothing;
insert into public.forum_replies(id,topic_id,seed_persona_id,body,created_at) values('f0200000-0000-4000-8000-000000000003','f0100000-0000-4000-8000-000000000002','mai','Có thể chia thành ba nhóm: quầy lễ tân, khu dịch vụ và kiểm tra thiết bị. Mỗi việc có người phụ trách, phần vệ sinh và khử khuẩn phải theo hướng dẫn đang áp dụng tại tiệm.',now()-interval '29 minutes'+interval '30 seconds') on conflict(id) do nothing;
insert into public.forum_replies(id,topic_id,seed_persona_id,body,created_at) values('f0200000-0000-4000-8000-000000000004','f0100000-0000-4000-8000-000000000002','nam','Phần đóng ca nên có đối chiếu số liệu, cất vật dụng và kiểm tra cửa. Đừng ghi thông tin khách hay mã báo động lên checklist chung nhé.',now()-interval '29 minutes'+interval '60 seconds') on conflict(id) do nothing;
insert into public.forum_topics(id,section_id,seed_persona_id,title,body,state,created_at,updated_at)
select 'f0100000-0000-4000-8000-000000000003',id,'anna','How do you handle walk-ins when the appointment book is full?','What is a clear way to explain the wait without promising a time the team cannot meet? I am looking for a simple front-desk routine that works during a busy afternoon.',null,now()-interval '28 minutes',now() from public.forum_sections where name='Salon operations' order by position,id limit 1 on conflict(id) do nothing;
insert into public.forum_replies(id,topic_id,seed_persona_id,body,created_at) values('f0200000-0000-4000-8000-000000000005','f0100000-0000-4000-8000-000000000003','minh','Start with a realistic range and ask whether the guest can wait. Confirm with the available technician before quoting a service start time.',now()-interval '28 minutes'+interval '30 seconds') on conflict(id) do nothing;
insert into public.forum_replies(id,topic_id,seed_persona_id,body,created_at) values('f0200000-0000-4000-8000-000000000006','f0100000-0000-4000-8000-000000000003','vy','An updated waitlist helps. If the estimate changes, tell the guest early and offer a later appointment instead of leaving them wondering.',now()-interval '28 minutes'+interval '60 seconds') on conflict(id) do nothing;
insert into public.forum_topics(id,section_id,seed_persona_id,title,body,state,created_at,updated_at)
select 'f0100000-0000-4000-8000-000000000004',id,'linh','Ngày đầu của thợ mới: hướng dẫn những gì trước?','Muốn có một buổi hướng dẫn gọn cho thành viên mới: lịch làm, cách nhận khách, chỗ lấy vật dụng, quy trình hỏi khách và ai hỗ trợ khi có vấn đề. Mọi người thường sắp xếp thứ tự thế nào?','FL',now()-interval '27 minutes',now() from public.forum_sections where name='Team & hiring' order by position,id limit 1 on conflict(id) do nothing;
insert into public.forum_replies(id,topic_id,seed_persona_id,body,created_at) values('f0200000-0000-4000-8000-000000000007','f0100000-0000-4000-8000-000000000004','thao','Mình sẽ bắt đầu bằng quy trình an toàn và vệ sinh, rồi mới tới cách nhận khách và phối hợp với lễ tân. Có một người hướng dẫn chính sẽ dễ hỏi hơn.',now()-interval '27 minutes'+interval '30 seconds') on conflict(id) do nothing;
insert into public.forum_replies(id,topic_id,seed_persona_id,body,created_at) values('f0200000-0000-4000-8000-000000000008','f0100000-0000-4000-8000-000000000004','huy','Nên có một tờ hướng dẫn ngắn, ghi rõ ai phụ trách từng việc. Cuối ca đầu dành ít phút hỏi lại xem bạn mới còn vướng ở bước nào.',now()-interval '27 minutes'+interval '60 seconds') on conflict(id) do nothing;
insert into public.forum_topics(id,section_id,seed_persona_id,title,body,state,created_at,updated_at)
select 'f0100000-0000-4000-8000-000000000005',id,'nam','Đổi ca vào phút cuối, nên thống nhất nguyên tắc gì?','Khi một bạn cần đổi ca gấp, nên báo trực tiếp cho chủ hay nhắn trong nhóm trước? Mình muốn có cách xử lý rõ ràng để không bỏ sót lịch hẹn và cũng không làm team thấy quá cứng nhắc.','GA',now()-interval '26 minutes',now() from public.forum_sections where name='Team & hiring' order by position,id limit 1 on conflict(id) do nothing;
insert into public.forum_replies(id,topic_id,seed_persona_id,body,created_at) values('f0200000-0000-4000-8000-000000000009','f0100000-0000-4000-8000-000000000005','vy','Cho phép tìm người đổi trong nhóm, nhưng người quản lý vẫn cần xác nhận trên lịch chính. Tin nhắn đồng ý riêng dễ bị bỏ sót.',now()-interval '26 minutes'+interval '30 seconds') on conflict(id) do nothing;
insert into public.forum_replies(id,topic_id,seed_persona_id,body,created_at) values('f0200000-0000-4000-8000-000000000010','f0100000-0000-4000-8000-000000000005','mai','Nên phân biệt việc khẩn cấp và đổi ca thông thường. Quan trọng là ai chịu trách nhiệm cập nhật lịch và báo cho lễ tân, tránh hai người cùng nghĩ người kia đã làm.',now()-interval '26 minutes'+interval '60 seconds') on conflict(id) do nothing;
insert into public.forum_topics(id,section_id,seed_persona_id,title,body,state,created_at,updated_at)
select 'f0100000-0000-4000-8000-000000000006',id,'minh','What should a useful salon job post include?','Besides the role and location, what details help applicants decide whether to reach out? I would like a short, clear post that sets expectations before the first conversation.',null,now()-interval '25 minutes',now() from public.forum_sections where name='Team & hiring' order by position,id limit 1 on conflict(id) do nothing;
insert into public.forum_replies(id,topic_id,seed_persona_id,body,created_at) values('f0200000-0000-4000-8000-000000000011','f0100000-0000-4000-8000-000000000006','anna','Include the schedule, skills needed, how to apply and what the interview process looks like. Keep the requirements specific to the actual role.',now()-interval '25 minutes'+interval '30 seconds') on conflict(id) do nothing;
insert into public.forum_replies(id,topic_id,seed_persona_id,body,created_at) values('f0200000-0000-4000-8000-000000000012','f0100000-0000-4000-8000-000000000006','linh','A Vietnamese and English version can help. Discuss compensation and employment terms clearly with each applicant, using the requirements that apply in your state.',now()-interval '25 minutes'+interval '60 seconds') on conflict(id) do nothing;
insert into public.forum_topics(id,section_id,seed_persona_id,title,body,state,created_at,updated_at)
select 'f0100000-0000-4000-8000-000000000007',id,'vy','Đăng hình nails: nên viết caption tiếng Việt hay tiếng Anh?','Nếu khách quanh tiệm chủ yếu nói tiếng Anh nhưng trang cũng có nhiều người Việt theo dõi thì nên viết hai ngôn ngữ trong một bài hay tách riêng? Mình muốn caption ngắn, không quá nhiều hashtag.','TX',now()-interval '24 minutes',now() from public.forum_sections where name='Marketing' order by position,id limit 1 on conflict(id) do nothing;
insert into public.forum_replies(id,topic_id,seed_persona_id,body,created_at) values('f0200000-0000-4000-8000-000000000013','f0100000-0000-4000-8000-000000000007','anna','Có thể đặt câu tiếng Anh trước, rồi một câu tiếng Việt ngắn bên dưới. Tên kiểu nails và lời mời đặt lịch nên rõ, không cần dịch từng chữ.',now()-interval '24 minutes'+interval '30 seconds') on conflict(id) do nothing;
insert into public.forum_replies(id,topic_id,seed_persona_id,body,created_at) values('f0200000-0000-4000-8000-000000000014','f0100000-0000-4000-8000-000000000007','thao','Hãy nhìn nhóm khách mình muốn phục vụ ở khu vực đó. Hình rõ, ánh sáng ổn và thông tin đặt lịch dễ tìm thường quan trọng hơn một caption dài.',now()-interval '24 minutes'+interval '60 seconds') on conflict(id) do nothing;
insert into public.forum_topics(id,section_id,seed_persona_id,title,body,state,created_at,updated_at)
select 'f0100000-0000-4000-8000-000000000008',id,'huy','Xin phép khách chụp hình bộ nails sao cho tự nhiên?','Có câu nào ngắn gọn để hỏi trước khi chụp và đăng lên trang tiệm không? Nếu chỉ chụp bàn tay thì có nên hỏi lại trước khi đăng không?','CA',now()-interval '23 minutes',now() from public.forum_sections where name='Marketing' order by position,id limit 1 on conflict(id) do nothing;
insert into public.forum_replies(id,topic_id,seed_persona_id,body,created_at) values('f0200000-0000-4000-8000-000000000015','f0100000-0000-4000-8000-000000000008','mai','Có thể nói: “Em chụp bộ nails này để đăng lên trang tiệm được không chị?” Nên cho khách biết mình định đăng ở đâu và tôn trọng nếu khách không muốn.',now()-interval '23 minutes'+interval '30 seconds') on conflict(id) do nothing;
insert into public.forum_replies(id,topic_id,seed_persona_id,body,created_at) values('f0200000-0000-4000-8000-000000000016','f0100000-0000-4000-8000-000000000008','vy','Nếu có tên, khuôn mặt hoặc chi tiết dễ nhận ra thì cần cẩn thận hơn. Không gắn tên hay tag tài khoản khách khi chưa được đồng ý.',now()-interval '23 minutes'+interval '60 seconds') on conflict(id) do nothing;
insert into public.forum_topics(id,section_id,seed_persona_id,title,body,state,created_at,updated_at)
select 'f0100000-0000-4000-8000-000000000009',id,'anna','What makes a helpful seasonal nail post?','For a seasonal collection, would you show one finished set or a few color options? Looking for ideas that make choosing a style easier without making the post feel crowded.',null,now()-interval '22 minutes',now() from public.forum_sections where name='Marketing' order by position,id limit 1 on conflict(id) do nothing;
insert into public.forum_replies(id,topic_id,seed_persona_id,body,created_at) values('f0200000-0000-4000-8000-000000000017','f0100000-0000-4000-8000-000000000009','linh','A strong first photo with one finished set works well as the cover. Add a small selection of related colors in the following images.',now()-interval '22 minutes'+interval '30 seconds') on conflict(id) do nothing;
insert into public.forum_replies(id,topic_id,seed_persona_id,body,created_at) values('f0200000-0000-4000-8000-000000000018','f0100000-0000-4000-8000-000000000009','nam','Keep the booking information easy to find, and describe what is pictured. Avoid implying every design takes the same time or has the same price.',now()-interval '22 minutes'+interval '60 seconds') on conflict(id) do nothing;
insert into public.forum_topics(id,section_id,seed_persona_id,title,body,state,created_at,updated_at)
select 'f0100000-0000-4000-8000-000000000010',id,'thao','Nên tạo chuyên mục mới hay đăng vào chuyên mục có sẵn?','Nếu có câu hỏi về cách tổ chức công việc ở tiệm, mình nên đăng trong Salon operations hay Reylumi Q&A? Muốn chọn đúng mục để mọi người dễ tìm lại.',null,now()-interval '21 minutes',now() from public.forum_sections where name='Reylumi Q&A' order by position,id limit 1 on conflict(id) do nothing;
insert into public.forum_replies(id,topic_id,seed_persona_id,body,created_at) values('f0200000-0000-4000-8000-000000000019','f0100000-0000-4000-8000-000000000010','minh','Câu hỏi về vận hành tiệm thì hợp với Salon operations. Nếu hỏi về chức năng hoặc cách sử dụng Reylumi thì chọn Reylumi Q&A sẽ dễ theo dõi hơn.',now()-interval '21 minutes'+interval '30 seconds') on conflict(id) do nothing;
insert into public.forum_replies(id,topic_id,seed_persona_id,body,created_at) values('f0200000-0000-4000-8000-000000000020','f0100000-0000-4000-8000-000000000010','mai','Tiêu đề nên nêu rõ vấn đề cụ thể. Nếu lỡ chọn sai chuyên mục, có thể nhờ mod chuyển bài thay vì đăng lại nhiều lần.',now()-interval '21 minutes'+interval '60 seconds') on conflict(id) do nothing;
insert into public.forum_topics(id,section_id,seed_persona_id,title,body,state,created_at,updated_at)
select 'f0100000-0000-4000-8000-000000000011',id,'minh','Lọc bài theo tiểu bang có bỏ sót bài toàn quốc không?','Có những vấn đề chỉ liên quan đến khu vực của mình, còn kinh nghiệm quản lý thì muốn đọc rộng hơn. Mọi người thường để All states hay chọn tiểu bang khi tìm bài?',null,now()-interval '20 minutes',now() from public.forum_sections where name='Reylumi Q&A' order by position,id limit 1 on conflict(id) do nothing;
insert into public.forum_replies(id,topic_id,seed_persona_id,body,created_at) values('f0200000-0000-4000-8000-000000000021','f0100000-0000-4000-8000-000000000011','huy','Nếu muốn xem tất cả thì để All states. Chọn một tiểu bang sẽ giúp thu hẹp danh sách về bài có gắn tiểu bang đó.',now()-interval '20 minutes'+interval '30 seconds') on conflict(id) do nothing;
insert into public.forum_replies(id,topic_id,seed_persona_id,body,created_at) values('f0200000-0000-4000-8000-000000000022','f0100000-0000-4000-8000-000000000011','anna','Có thể tìm bằng từ khóa trước rồi mới chọn chuyên mục hoặc tiểu bang. Với câu hỏi chung, đăng Nationwide sẽ phù hợp hơn việc chọn ngẫu nhiên một bang.',now()-interval '20 minutes'+interval '60 seconds') on conflict(id) do nothing;
insert into public.forum_topics(id,section_id,seed_persona_id,title,body,state,created_at,updated_at)
select 'f0100000-0000-4000-8000-000000000012',id,'anna','Where should we share a Reylumi feature idea?','If an idea is useful to other salon owners, is this section a good place to discuss it first? What details would make the suggestion easier to understand?',null,now()-interval '19 minutes',now() from public.forum_sections where name='Reylumi Q&A' order by position,id limit 1 on conflict(id) do nothing;
insert into public.forum_replies(id,topic_id,seed_persona_id,body,created_at) values('f0200000-0000-4000-8000-000000000023','f0100000-0000-4000-8000-000000000012','vy','Describe the task you are trying to finish, the point where you get stuck and the result you would like. One concrete example makes the discussion much easier.',now()-interval '19 minutes'+interval '30 seconds') on conflict(id) do nothing;
insert into public.forum_replies(id,topic_id,seed_persona_id,body,created_at) values('f0200000-0000-4000-8000-000000000024','f0100000-0000-4000-8000-000000000012','thao','Keep customer information and private business records out of screenshots. Account-specific issues are better sent through support.',now()-interval '19 minutes'+interval '60 seconds') on conflict(id) do nothing;
insert into public.forum_topics(id,section_id,seed_persona_id,title,body,state,created_at,updated_at)
select 'f0100000-0000-4000-8000-000000000013',id,'mai','Một thay đổi nhỏ giúp buổi sáng ở tiệm nhẹ hơn?','Muốn mở một cuộc trò chuyện nhẹ: nếu chỉ chọn một việc để buổi sáng ở tiệm bớt rối, mọi người sẽ chọn việc gì? Một thói quen hay một cách sắp xếp nhỏ cũng được.','WA',now()-interval '18 minutes',now() from public.forum_sections where name='Owner lounge' order by position,id limit 1 on conflict(id) do nothing;
insert into public.forum_replies(id,topic_id,seed_persona_id,body,created_at) values('f0200000-0000-4000-8000-000000000025','f0100000-0000-4000-8000-000000000013','nam','Chuẩn bị khu vực lễ tân từ cuối ngày trước. Buổi sáng chỉ cần kiểm tra lịch, vật dụng và việc cần bàn giao, đỡ phải tìm mọi thứ cùng lúc.',now()-interval '18 minutes'+interval '30 seconds') on conflict(id) do nothing;
insert into public.forum_replies(id,topic_id,seed_persona_id,body,created_at) values('f0200000-0000-4000-8000-000000000026','f0100000-0000-4000-8000-000000000013','linh','Một cuộc trao đổi ngắn trước ca: hôm nay có lịch gì cần lưu ý, ai phụ trách phần nào. Chỉ vài phút nhưng giúp cả team bắt nhịp.',now()-interval '18 minutes'+interval '60 seconds') on conflict(id) do nothing;
insert into public.forum_topics(id,section_id,seed_persona_id,title,body,state,created_at,updated_at)
select 'f0100000-0000-4000-8000-000000000014',id,'vy','Chủ tiệm mới nên hỏi điều gì từ người đi trước?','Nếu được ngồi uống cà phê với một chủ tiệm có kinh nghiệm, mọi người muốn hỏi điều gì đầu tiên? Mình nghĩ những chuyện nhỏ trong ngày thường khó tìm trong một bản kế hoạch.','AZ',now()-interval '17 minutes',now() from public.forum_sections where name='Owner lounge' order by position,id limit 1 on conflict(id) do nothing;
insert into public.forum_replies(id,topic_id,seed_persona_id,body,created_at) values('f0200000-0000-4000-8000-000000000027','f0100000-0000-4000-8000-000000000014','huy','Mình sẽ hỏi cách họ phân biệt việc cần chủ xử lý ngay và việc có thể giao cho team. Không phải chuyện nào cũng cần chủ đứng ra.',now()-interval '17 minutes'+interval '30 seconds') on conflict(id) do nothing;
insert into public.forum_replies(id,topic_id,seed_persona_id,body,created_at) values('f0200000-0000-4000-8000-000000000028','f0100000-0000-4000-8000-000000000014','thao','Mình muốn nghe cách xây dựng quy trình bàn giao và phản hồi cho nhau. Một quy trình rõ giúp người mới bớt phải đoán.',now()-interval '17 minutes'+interval '60 seconds') on conflict(id) do nothing;
insert into public.forum_topics(id,section_id,seed_persona_id,title,body,state,created_at,updated_at)
select 'f0100000-0000-4000-8000-000000000015',id,'minh','What would you tell yourself before opening a salon?','One practical lesson, one question you wish you had asked, or one routine you would set up earlier. What would you share with someone preparing for their first opening day?',null,now()-interval '16 minutes',now() from public.forum_sections where name='Owner lounge' order by position,id limit 1 on conflict(id) do nothing;
insert into public.forum_replies(id,topic_id,seed_persona_id,body,created_at) values('f0200000-0000-4000-8000-000000000029','f0100000-0000-4000-8000-000000000015','anna','Write down the everyday routines before opening: appointments, supplies, handoffs and closing. A simple process is easier to improve than a rule nobody can find.',now()-interval '16 minutes'+interval '30 seconds') on conflict(id) do nothing;
insert into public.forum_replies(id,topic_id,seed_persona_id,body,created_at) values('f0200000-0000-4000-8000-000000000030','f0100000-0000-4000-8000-000000000015','mai','Leave room to learn from the team and the guests. Clear communication matters just as much as a beautiful space.',now()-interval '16 minutes'+interval '60 seconds') on conflict(id) do nothing;
create or replace function public.forum_read(p_input jsonb default '{}') returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_user uuid:=public.forum_actor(); mode text:=coalesce(p_input->>'mode','feed');
 v_mod boolean:=public.platform_admin_has_permission('admin.forum.moderate'); v_manage boolean:=public.platform_admin_has_permission('admin.forum.manage');
 result jsonb; v_topic uuid; v_before timestamptz; v_after timestamptz; v_cursor uuid; begin
 if mode='context' then
 return jsonb_build_object('user_id',v_user,'can_moderate',v_mod,'can_manage',v_manage,
 'display_name',(select coalesce(nullif(display_name,''),'Owner') from public.users where id=v_user),
 'restriction',(select to_jsonb(x)-'actor_id' from public.forum_restrictions x where user_id=v_user and (expires_at is null or expires_at>now())),
 'sections',coalesce((select jsonb_agg(to_jsonb(s) order by position,id) from public.forum_sections s where not archived or v_manage),'[]'::jsonb));
 elsif mode in ('feed','saved','mine','removed') then
 if mode='removed' and not v_mod then raise exception 'Moderator permission required.' using errcode='42501'; end if;
 v_before:=nullif(p_input->>'before','')::timestamptz; v_cursor:=nullif(p_input->>'cursor_id','')::uuid;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.pinned desc,x.created_at desc,x.id desc),'[]') into result from (
 select t.id,t.author_id,t.section_id,t.title,t.state,t.pinned,t.locked,t.deleted_at,t.created_at,t.updated_at,
 coalesce(nullif(u.display_name,''),p.display_name,'Owner') author_name, p.avatar_path author_avatar,
 (select count(*) from public.forum_replies r where r.topic_id=t.id and r.deleted_at is null) reply_count,
 exists(select 1 from public.forum_bookmarks b where b.topic_id=t.id and b.user_id=v_user) bookmarked
 from public.forum_topics t left join public.users u on u.id=t.author_id left join public.forum_seed_personas p on p.id=t.seed_persona_id
 where ((mode='removed' and t.deleted_at is not null) or (mode<>'removed' and t.deleted_at is null))
 and (mode<>'saved' or exists(select 1 from public.forum_bookmarks b where b.topic_id=t.id and b.user_id=v_user))
 and (mode<>'mine' or t.author_id=v_user)
 and (nullif(p_input->>'section','') is null or t.section_id=(p_input->>'section')::uuid)
 and (nullif(p_input->>'state','') is null or t.state=p_input->>'state')
 and (nullif(btrim(left(p_input->>'q',150)),'') is null or t.search_vector @@ websearch_to_tsquery('simple',left(p_input->>'q',150)))
 and (coalesce(p_input->>'unanswered','false')<>'true' or not exists(select 1 from public.forum_replies r where r.topic_id=t.id and r.deleted_at is null))
 and (v_before is null or (t.pinned,t.created_at,t.id)<(coalesce((p_input->>'before_pinned')::boolean,false),v_before,coalesce(v_cursor,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
 order by t.pinned desc,t.created_at desc,t.id desc limit 21) x;
 return result;
 elsif mode='topic' then
 v_topic:=(p_input->>'id')::uuid;
 select to_jsonb(x) into result from (select t.id,t.author_id,t.section_id,t.title,t.body,t.state,t.pinned,t.locked,t.deleted_at,t.created_at,t.updated_at,coalesce(nullif(u.display_name,''),p.display_name,'Owner') author_name, p.avatar_path author_avatar,
 exists(select 1 from public.forum_bookmarks b where b.topic_id=t.id and b.user_id=v_user) bookmarked
 from public.forum_topics t left join public.users u on u.id=t.author_id left join public.forum_seed_personas p on p.id=t.seed_persona_id where t.id=v_topic and (t.deleted_at is null or v_mod)) x;
 if result is null then raise exception 'Topic not found.' using errcode='P0002'; end if;
 v_after:=nullif(p_input->>'after','')::timestamptz; v_cursor:=nullif(p_input->>'cursor_id','')::uuid;
 return jsonb_build_object('topic',result,'replies',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from (
 select r.*,coalesce(nullif(u.display_name,''),p.display_name,'Owner') author_name, p.avatar_path author_avatar from public.forum_replies r left join public.users u on u.id=r.author_id left join public.forum_seed_personas p on p.id=r.seed_persona_id
 where r.topic_id=v_topic and (r.deleted_at is null or v_mod)
 and (v_after is null or (r.created_at,r.id)>(v_after,coalesce(v_cursor,'00000000-0000-0000-0000-000000000000'::uuid)))
 order by r.created_at,r.id limit 31) x),'[]'::jsonb));
 elsif mode='chat' then
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.id::bigint) from (
 select c.id::text id,c.author_id,c.body,c.created_at,coalesce(nullif(u.display_name,''),'Owner') author_name
 from public.forum_chat c left join public.users u on u.id=c.author_id
 where c.deleted_at is null and (nullif(p_input->>'before_id','') is null or c.id<(p_input->>'before_id')::bigint)
 and (nullif(p_input->>'after_id','') is null or c.id>(p_input->>'after_id')::bigint)
 order by c.id desc limit 41) x),'[]'::jsonb);
 elsif mode in ('reports','restrictions','audit') then
 if not v_mod then raise exception 'Moderator permission required.' using errcode='42501'; end if;
 if mode='reports' then
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
 select a.*, coalesce(u.display_name,'Owner') reporter_name,
 case a.target_type when 'topic' then (select author_id from public.forum_topics where id::text=a.target_id)
 when 'reply' then (select author_id from public.forum_replies where id::text=a.target_id)
 else (select author_id from public.forum_chat where id::text=a.target_id) end author_id,
 case a.target_type when 'topic' then a.target_id when 'reply' then (select topic_id::text from public.forum_replies where id::text=a.target_id) else null end topic_id,
 case a.target_type when 'topic' then (select left(title||E'\n'||body,1200) from public.forum_topics where id::text=a.target_id)
 when 'reply' then (select left(body,1200) from public.forum_replies where id::text=a.target_id)
 else (select body from public.forum_chat where id::text=a.target_id) end preview
 from public.forum_reports a left join public.users u on u.id=a.reporter_id where a.resolved_at is null order by a.created_at desc limit 50) x),'[]'::jsonb);
 elsif mode='restrictions' then
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.updated_at desc) from (
 select a.*,coalesce(u.display_name,'Owner') display_name from public.forum_restrictions a left join public.users u on u.id=a.user_id
 where a.expires_at is null or a.expires_at>now() order by a.updated_at desc limit 50) x),'[]'::jsonb);
 else return coalesce((select jsonb_agg(to_jsonb(x) order by x.id::bigint desc) from (
 select a.id::text id,a.action,a.target_type,a.target_id,a.reason,a.details,a.created_at,coalesce(u.display_name,'Moderator') actor_name
 from public.forum_audit a left join public.users u on u.id=a.actor_id order by a.id desc limit 50) x),'[]'::jsonb); end if;
 end if;
 raise exception 'Unknown forum view.';
end $$;
revoke all on function public.forum_read(jsonb) from public,anon;
grant execute on function public.forum_read(jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;

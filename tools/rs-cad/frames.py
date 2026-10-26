#!/usr/bin/env python3
"""Extract top-level sub-assembly placement frames (joint frames) from an AP214 STEP file."""
import re, sys, math

path = sys.argv[1]
data = open(path, 'r', encoding='utf-8', errors='replace').read()
data = data[data.index('DATA;')+5 : data.index('ENDSEC;', data.index('DATA;'))]
# join into records split on ';'
data = data.replace('\r',' ').replace('\n',' ')
records = {}
for rec in data.split(';'):
    rec = rec.strip()
    if not rec or not rec.startswith('#'):
        continue
    m = re.match(r'#(\d+)\s*=\s*(.*)$', rec, re.S)
    if not m:
        continue
    records[int(m.group(1))] = m.group(2).strip()

def refs(s):
    return [int(x) for x in re.findall(r'#(\d+)', s)]

def enttype(body):
    m = re.match(r'([A-Z_0-9]+)\s*\(', body)
    return m.group(1) if m else None

# --- resolve product name for a product_definition id ---
def pd_product_name(pd_id):
    body = records.get(pd_id, '')
    r = refs(body)  # PRODUCT_DEFINITION(name,desc,#formation,#context)
    for x in r:
        b = records.get(x, '')
        if enttype(b) == 'PRODUCT_DEFINITION_FORMATION' or enttype(b)=='PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE':
            for y in refs(b):
                pb = records.get(y,'')
                if enttype(pb) == 'PRODUCT':
                    nm = re.match(r"PRODUCT\('([^']*)'", pb)
                    return nm.group(1) if nm else '?'
    return None

# --- collect NAUOs: relating (parent) , related (child) ---
nauos = {}   # id -> (parent_pd, child_pd, name)
for i,body in records.items():
    if enttype(body) == 'NEXT_ASSEMBLY_USAGE_OCCURRENCE':
        nm = re.match(r"NEXT_ASSEMBLY_USAGE_OCCURRENCE\('([^']*)'", body)
        r = refs(body)  # last two refs are relating_pd, related_pd
        if len(r) >= 2:
            nauos[i] = (r[-2], r[-1], nm.group(1) if nm else '')

# find root assembly product def = '00-ARM-RS_ASM'
root_pd = None
for i,body in records.items():
    if enttype(body) == 'PRODUCT_DEFINITION':
        if pd_product_name(i) == '00-ARM-RS_ASM':
            root_pd = i
            break
print('root_pd =', root_pd, file=sys.stderr)

# --- matrix helpers ---
def get_dir(did):
    b = records.get(did,'')
    m = re.search(r'\(\s*([-0-9.eE]+)\s*,\s*([-0-9.eE]+)\s*,\s*([-0-9.eE]+)\s*\)\s*\)\s*$', b)
    if not m:
        nums = re.findall(r'[-0-9.eE]+', b)
        return [float(nums[-3]),float(nums[-2]),float(nums[-1])]
    return [float(m.group(1)),float(m.group(2)),float(m.group(3))]

def get_point(pid):
    b = records.get(pid,'')
    nums = re.findall(r'[-0-9.eE]+', b.split('(',1)[1])
    return [float(nums[-3]),float(nums[-2]),float(nums[-1])]

def a2p_matrix(a2p_id):
    """Return (origin[3], xaxis[3], yaxis[3], zaxis[3]) from AXIS2_PLACEMENT_3D."""
    b = records.get(a2p_id,'')
    r = refs(b)  # #loc, #axis(z-dir), #ref(x-dir)   (dirs optional)
    loc = get_point(r[0])
    z = [0,0,1]; x = [1,0,0]
    # order: location, axis(Z), ref_direction(X)
    dirrefs = r[1:]
    if len(dirrefs) >= 1 and records.get(dirrefs[0],'').startswith('DIRECTION'):
        z = get_dir(dirrefs[0])
    if len(dirrefs) >= 2 and records.get(dirrefs[1],'').startswith('DIRECTION'):
        x = get_dir(dirrefs[1])
    z = norm(z)
    # make x orthogonal to z
    x = sub(x, scale(z, dot(x,z)))
    if length(x) < 1e-9: x = [1,0,0]
    x = norm(x)
    y = cross(z,x)
    return loc, x, y, z

def norm(v):
    l=length(v)
    return [v[0]/l,v[1]/l,v[2]/l] if l>1e-12 else v
def length(v): return math.sqrt(sum(c*c for c in v))
def dot(a,b): return sum(a[i]*b[i] for i in range(3))
def cross(a,b): return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]
def sub(a,b): return [a[i]-b[i] for i in range(3)]
def scale(a,s): return [a[i]*s for i in range(3)]

def mat_from_axes(o,x,y,z):
    # column-major 4x4 as rows for readability: R columns = x,y,z
    return [
        [x[0],y[0],z[0],o[0]],
        [x[1],y[1],z[1],o[1]],
        [x[2],y[2],z[2],o[2]],
        [0,0,0,1]]

def matmul(A,B):
    return [[sum(A[i][k]*B[k][j] for k in range(4)) for j in range(4)] for i in range(4)]

def mat_inv_rigid(M):
    R=[[M[i][j] for j in range(3)] for i in range(3)]
    t=[M[i][3] for i in range(3)]
    Rt=[[R[j][i] for j in range(3)] for i in range(3)]
    it=[-sum(Rt[i][k]*t[k] for k in range(3)) for i in range(3)]
    return [[Rt[0][0],Rt[0][1],Rt[0][2],it[0]],
            [Rt[1][0],Rt[1][1],Rt[1][2],it[1]],
            [Rt[2][0],Rt[2][1],Rt[2][2],it[2]],
            [0,0,0,1]]

# --- for a NAUO, find its transform matrix (child frame in parent frame) ---
# wiring: PRODUCT_DEFINITION_SHAPE('','',#nauo) ; CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(#rrwt,#pds)
# #rrwt = (REPRESENTATION_RELATIONSHIP('','',#rep1,#rep2) REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(#idt) ...)
# #idt = ITEM_DEFINED_TRANSFORMATION('','',#a2p1,#a2p2)
# Build indices
pds_for_nauo = {}   # nauo_id -> pds_id
for i,body in records.items():
    if enttype(body) == 'PRODUCT_DEFINITION_SHAPE':
        for x in refs(body):
            if x in nauos:
                pds_for_nauo[x] = i

cdsr = []  # (rrwt_id, pds_id)
for i,body in records.items():
    if enttype(body) == 'CONTEXT_DEPENDENT_SHAPE_REPRESENTATION':
        r = refs(body)
        if len(r)>=2: cdsr.append((r[0],r[1]))
pds_to_rrwt = {}
for rrwt,pds in cdsr:
    pds_to_rrwt[pds]=rrwt

def idt_of_rrwt(rrwt_id):
    b = records.get(rrwt_id,'')
    # find ITEM_DEFINED_TRANSFORMATION ref
    for x in refs(b):
        if enttype(records.get(x,'')) == 'ITEM_DEFINED_TRANSFORMATION':
            return x
    # complex record: search text
    m = re.search(r'REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION\(\s*#(\d+)', b)
    if m:
        return int(m.group(1))
    return None

def nauo_transform(nauo_id):
    pds = pds_for_nauo.get(nauo_id)
    if pds is None: return None
    rrwt = pds_to_rrwt.get(pds)
    if rrwt is None: return None
    idt = idt_of_rrwt(rrwt)
    if idt is None: return None
    r = refs(records.get(idt,''))
    a2ps = [x for x in r if records.get(x,'').startswith('AXIS2_PLACEMENT_3D')]
    if len(a2ps)<2: return None
    o1,x1,y1,z1 = a2p_matrix(a2ps[0])
    o2,x2,y2,z2 = a2p_matrix(a2ps[1])
    M1 = mat_from_axes(o1,x1,y1,z1)
    M2 = mat_from_axes(o2,x2,y2,z2)
    # transform mapping item1->item2 in parent coords: child_in_parent = M1 * inv(M2)?  try M1*inv(M2)
    T = matmul(M1, mat_inv_rigid(M2))
    return T, M1, M2

# top-level children of root
print('name | origin(mm) | zAxis | xAxis', file=sys.stderr)
import json
out=[]
for nid,(par,chi,nm) in nauos.items():
    if par == root_pd:
        cname = pd_product_name(chi)
        tr = nauo_transform(nid)
        if not tr:
            print(f'{cname}: NO TRANSFORM', file=sys.stderr); continue
        T,M1,M2 = tr
        o=[T[0][3],T[1][3],T[2][3]]
        z=[T[0][2],T[1][2],T[2][2]]
        x=[T[0][0],T[1][0],T[2][0]]
        out.append({'name':cname,'origin':o,'x':x,'z':z,
                    'M1o':[M1[0][3],M1[1][3],M1[2][3]],'M2o':[M2[0][3],M2[1][3],M2[2][3]]})

out.sort(key=lambda d:d['name'])
for d in out:
    print(f"{d['name']:20s} o=({d['origin'][0]:8.1f},{d['origin'][1]:8.1f},{d['origin'][2]:8.1f})  "
          f"z=({d['z'][0]:5.2f},{d['z'][1]:5.2f},{d['z'][2]:5.2f})  x=({d['x'][0]:5.2f},{d['x'][1]:5.2f},{d['x'][2]:5.2f})  "
          f"M1o=({d['M1o'][0]:.0f},{d['M1o'][1]:.0f},{d['M1o'][2]:.0f}) M2o=({d['M2o'][0]:.0f},{d['M2o'][1]:.0f},{d['M2o'][2]:.0f})")
json.dump(out, open('frames.json','w'), indent=1)
